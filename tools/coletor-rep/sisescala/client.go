// Package sisescala chama /api/rep/v1/* — autenticação por token de dispositivo + assinatura
// HMAC anti-replay, no mesmo esquema descrito em src/utils/repDeviceAuth.ts. Deliberadamente
// não usa um segredo único compartilhado (o padrão do /api/cron que o plano pede para não
// copiar): a chave do HMAC é o próprio token do dispositivo.
package sisescala

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// ============================================================================
// Compensacao de desvio de relogio da maquina (17/08/2026)
// ============================================================================
// A assinatura anti-replay carrega um timestamp, e o servidor recusa desvio maior que 5 minutos
// (repDeviceAuth.ts). Quando o relogio do Windows da maquina esta fora, TODA rota /api/rep/v1/*
// passa a devolver 401 — nao so o heartbeat: EnviarLote, pendencias e biometria usam o mesmo HMAC.
// Foi o que aconteceu na maquina do RH da SMS em 17/08/2026: o AFD baixava certo e os ~80 lotes
// iam integralmente para a fila offline, com a tela do SisEscala vazia e nenhuma pista do motivo
// para quem olhava de fora.
//
// A correcao NAO e' o coletor ajustar o relogio do Windows. Isso exige SeSystemtimePrivilege, que
// usuario comum nao tem — e este app roda deliberadamente SEM administrador (autostart em HKCU,
// ver README). Pedir elevacao para instalar quebraria essa decisao inteira.
//
// A correcao e' o coletor PARAR DE DEPENDER do relogio local: o timestamp da assinatura passa a
// ser derivado do horario do proprio servidor, lido do header `Date` de qualquer resposta HTTP.
//
// Isso nao enfraquece o anti-replay. Quem decide o que e' "agora" continua sendo exclusivamente o
// servidor, que segue recusando qualquer timestamp fora da janela dele; alinhar-se ao relogio dele
// so permite que um cliente HONESTO produza um timestamp que ele considere atual. Um atacante
// reproduzindo requisicao capturada nao ganha nada com isso — a janela de 5 minutos do servidor
// continua valendo igual.
//
// ⚠️ Compensar NAO e' esconder: desvio grande vira aviso explicito no log a cada ciclo, porque a
// hora errada do Windows continua sendo um problema real daquela maquina (e' o que o usuario ve na
// tela do terminal de presenca, por exemplo). O coletor deixa de ser vitima dela, nao a resolve.
//
// O desvio e' de PROCESSO, nao de instancia de Client: cada funcao do ciclo cria seu proprio
// Client, e reaprender o offset em cada um custaria um 401+retry por operacao. E' propriedade da
// relacao maquina<->servidor, entao mora aqui.
var desvioServidorMs atomic.Int64

// margemAvisoDesvioMs e' de quando o desvio merece aviso no log. Bem abaixo dos 5 min do servidor:
// a ideia e avisar ANTES de virar recusa, para o problema ser corrigido antes de parar tudo.
const margemAvisoDesvioMs = 60 * 1000

// DesvioServidor devolve o desvio aprendido (servidor - maquina). Positivo = relogio da maquina
// ATRASADO. Zero enquanto nenhuma resposta HTTP tiver sido lida ainda.
func DesvioServidor() time.Duration {
	return time.Duration(desvioServidorMs.Load()) * time.Millisecond
}

// aprenderDesvio le o header Date da resposta e atualiza o desvio de processo.
//
// `Date` tem resolucao de 1 segundo e a resposta leva algum tempo para chegar, entao o instante
// local usado na comparacao e' o PONTO MEDIO entre o envio e a chegada — mesmo raciocinio do NTP,
// para a latencia da rede nao ser confundida com desvio de relogio. Ruido de +-1s e' irrelevante
// contra uma janela de 5 minutos.
func aprenderDesvio(resp *http.Response, enviadoEm, recebidoEm time.Time) {
	cabecalho := resp.Header.Get("Date")
	if cabecalho == "" {
		return // sem Date nao ha o que aprender; segue com o desvio que ja tinha
	}
	horaServidor, err := http.ParseTime(cabecalho)
	if err != nil {
		return
	}

	localNoMeio := enviadoEm.Add(recebidoEm.Sub(enviadoEm) / 2)
	novo := horaServidor.Sub(localNoMeio).Milliseconds()
	anterior := desvioServidorMs.Swap(novo)

	// Avisa quando o desvio e' relevante e quando ele APARECE (nao a cada resposta, o que
	// encheria o log de linha repetida a cada lote de 500 linhas).
	if abs64(novo) >= margemAvisoDesvioMs && abs64(novo-anterior) >= margemAvisoDesvioMs {
		situacao := "atrasado"
		if novo < 0 {
			situacao = "adiantado"
		}
		log.Printf("AVISO: o relogio deste computador esta %s %s em relacao ao servidor. "+
			"A assinatura das requisicoes esta sendo compensada automaticamente, mas CORRIJA a hora "+
			"do Windows (Configuracoes > Hora e idioma > Sincronizar agora, ou 'w32tm /resync /force' "+
			"como administrador) — a hora errada continua aparecendo em todo o resto da maquina.",
			situacao, (time.Duration(abs64(novo)) * time.Millisecond).Round(time.Second))
	}
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

type Client struct {
	baseURL       string
	dispositivoID string
	token         string
	httpClient    *http.Client
}

func NovoClient(baseURL, dispositivoID, token string) *Client {
	return &Client{
		baseURL:       baseURL,
		dispositivoID: dispositivoID,
		token:         token,
		httpClient:    &http.Client{Timeout: 60 * time.Second},
	}
}

// assinar usa o horario do SERVIDOR (relogio local + desvio aprendido), nunca o local puro — ver
// o bloco de comentario no topo do arquivo.
func (c *Client) assinar(corpo []byte) (timestamp, assinatura string) {
	ts := strconv.FormatInt(time.Now().UnixMilli()+desvioServidorMs.Load(), 10)
	somaCorpo := sha256.Sum256(corpo)

	mac := hmac.New(sha256.New, []byte(c.token))
	mac.Write([]byte(ts + hex.EncodeToString(somaCorpo[:])))
	return ts, hex.EncodeToString(mac.Sum(nil))
}

// chamar faz a requisicao e, se ela for recusada especificamente por anti-replay, tenta UMA vez
// mais depois de aprender o desvio com o header Date daquela propria resposta.
//
// O retry existe para o caso de arranque: na primeira requisicao de um processo o desvio ainda e'
// zero, entao uma maquina com relogio muito fora e' recusada antes de ter tido qualquer chance de
// aprender. Sem ele, o coletor levaria um ciclo inteiro (5 min) recusado a cada vez que subisse.
func (c *Client) chamar(metodo, caminho string, corpo []byte) ([]byte, int, error) {
	respBytes, status, err := c.chamarUmaVez(metodo, caminho, corpo)
	if err != nil || status != http.StatusUnauthorized || !recusadoPorAntiReplay(respBytes) {
		return respBytes, status, err
	}

	// aprenderDesvio ja rodou dentro de chamarUmaVez com o Date desta resposta, entao a assinatura
	// da segunda tentativa ja sai com o desvio novo. Uma tentativa so: se ainda for recusado, o
	// problema nao e' desvio de relogio e insistir viraria laco.
	log.Printf("requisicao recusada por anti-replay; desvio de relogio aprendido (%s) e tentando "+
		"novamente uma vez", DesvioServidor().Round(time.Second))
	return c.chamarUmaVez(metodo, caminho, corpo)
}

// recusadoPorAntiReplay distingue "timestamp fora da janela" (que o retry resolve) de token
// invalido/dispositivo inativo (que o retry nao resolve). A checagem de janela roda ANTES da
// validacao do token em repDeviceAuth.ts, entao os dois casos chegam aqui como 401.
func recusadoPorAntiReplay(respBytes []byte) bool {
	return strings.Contains(string(respBytes), "anti-replay")
}

func (c *Client) chamarUmaVez(metodo, caminho string, corpo []byte) ([]byte, int, error) {
	if corpo == nil {
		corpo = []byte{}
	}
	timestamp, assinatura := c.assinar(corpo)

	req, err := http.NewRequest(metodo, c.baseURL+caminho, bytes.NewReader(corpo))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-SisEscala-Dispositivo", c.dispositivoID)
	req.Header.Set("X-SisEscala-Timestamp", timestamp)
	req.Header.Set("X-SisEscala-Assinatura", assinatura)

	enviadoEm := time.Now()
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	aprenderDesvio(resp, enviadoEm, time.Now())

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return respBytes, resp.StatusCode, nil
}

type ResultadoIngestao struct {
	Reenvio       bool   `json:"reenvio"`
	Sincronizacao string `json:"sincronizacao_id"`
	Recebidas     int    `json:"recebidas"`
	Novas         int    `json:"novas"`
	Duplicadas    int    `json:"duplicadas"`
	Marcacoes     int    `json:"marcacoes"`
	Orfas         int    `json:"orfas"`
	NsrInicial    int64  `json:"nsr_inicial"`
	NsrMaxAceito  int64  `json:"nsr_max_aceito"`
}

// EnviarLote envia até 500 linhas de AFD. loteID precisa ser ESTÁVEL entre reenvios do MESMO
// lote (o chamador usa um hash determinístico do conteúdo) — é isso que faz fn_ingerir_afd
// tratar o reenvio como no-op em vez de reprocessar.
func (c *Client) EnviarLote(loteID string, linhas []string, arquivoSHA256, coletorVersao, coletorHost string) (*ResultadoIngestao, error) {
	payload := map[string]interface{}{
		"lote_id":        loteID,
		"linhas":         linhas,
		"arquivo_sha256": arquivoSHA256,
		"coletor_versao": coletorVersao,
		"coletor_host":   coletorHost,
	}
	corpo, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	respBytes, status, err := c.chamar(http.MethodPost, "/api/rep/v1/marcacoes", corpo)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("falha ao enviar lote (HTTP %d): %s", status, string(respBytes))
	}

	var resultado ResultadoIngestao
	if err := json.Unmarshal(respBytes, &resultado); err != nil {
		return nil, fmt.Errorf("resposta invalida do SisEscala: %s", string(respBytes))
	}
	return &resultado, nil
}

// EstadoIngestao é o que GET /api/rep/v1/estado devolve: de qual NSR este dispositivo deve pedir
// o AFD. UltimoNsr vem só para o log — quem manda é ProximoNsr.
type EstadoIngestao struct {
	ProximoNsr int64  `json:"proximo_nsr"`
	UltimoNsr  *int64 `json:"ultimo_nsr"`
}

// EstadoIngestao pergunta ao SisEscala o cursor de coleta deste dispositivo (fim do trecho
// contíguo de NSR + 1, ver fn_cursor_afd_dispositivo). É o que permite pedir só o incremento ao
// relógio em vez do arquivo inteiro a cada ciclo.
//
// Um ProximoNsr < 1 é tratado como resposta inválida em vez de ser usado: cursor grande demais é
// a única forma de PERDER marcação (o relógio simplesmente não devolveria as linhas anteriores),
// então qualquer dúvida aqui tem que virar erro e deixar o chamador cair para o fallback.
func (c *Client) EstadoIngestao() (*EstadoIngestao, error) {
	respBytes, status, err := c.chamar(http.MethodGet, "/api/rep/v1/estado", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("falha ao consultar estado de ingestao (HTTP %d): %s", status, string(respBytes))
	}

	var estado EstadoIngestao
	if err := json.Unmarshal(respBytes, &estado); err != nil {
		return nil, fmt.Errorf("resposta invalida do SisEscala: %s", string(respBytes))
	}
	if estado.ProximoNsr < 1 {
		return nil, fmt.Errorf("cursor invalido devolvido pelo SisEscala (proximo_nsr=%d)", estado.ProximoNsr)
	}
	return &estado, nil
}

// CadastroPendente é um item da fila de push de identidade (Fase 7 — ver
// fn_cadastros_pendentes_dispositivo). identificador_afd já vem pronto no formato de 12
// dígitos que o AFD usa (CPF com zero de preenchimento à esquerda).
type CadastroPendente struct {
	FilaID           string `json:"fila_id"`
	ServidorID       string `json:"servidor_id"`
	Matricula        string `json:"matricula"`
	Nome             string `json:"nome"`
	IdentificadorAFD string `json:"identificador_afd"`
}

// ListarCadastrosPendentes busca a fila de identidade a enviar ao relógio deste dispositivo.
func (c *Client) ListarCadastrosPendentes() ([]CadastroPendente, error) {
	respBytes, status, err := c.chamar(http.MethodGet, "/api/rep/v1/pendencias", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("falha ao listar cadastros pendentes (HTTP %d): %s", status, string(respBytes))
	}

	var pendentes []CadastroPendente
	if err := json.Unmarshal(respBytes, &pendentes); err != nil {
		return nil, fmt.Errorf("resposta invalida do SisEscala: %s", string(respBytes))
	}
	return pendentes, nil
}

// ConfirmarCadastro reporta o resultado de um item da fila. Idempotente: reenviar a confirmação de
// um item já processado não faz nada (fn_confirmar_cadastro_rep ignora silenciosamente).
//
// identificadorAfd é o identificador que o RELÓGIO informou depois de criar o usuário, lido de
// volta por relistagem — não o que mandamos. Vazio deixa o servidor cair no cálculo por CPF, que
// segue correto nos relógios cadastrados por CPF. Isso existe porque no relógio da SMS
// (cadastrado por PIS pelo sistema anterior) um vínculo calculado do CPF nunca casaria com as
// linhas do AFD, em silêncio: as batidas continuariam órfãs e a tela diria que estava tudo certo.
//
// transitorio distingue "não consegui FALAR com o relógio" (rede/timeout: o item volta para a
// fila com espera) de "o relógio RECUSOU" (definitivo). Sem essa distinção, o ciclo automático
// queimaria o cadastro de uma pessoa por causa de um blecaute de um minuto.
func (c *Client) ConfirmarCadastro(
	filaID string, sucesso bool, deviceUserID *int64, mensagemErro, identificadorAfd string, transitorio bool,
) error {
	payload := map[string]interface{}{"fila_id": filaID, "sucesso": sucesso}
	if deviceUserID != nil {
		payload["device_user_id"] = *deviceUserID
	}
	if mensagemErro != "" {
		payload["erro"] = mensagemErro
	}
	if identificadorAfd != "" {
		payload["identificador_afd"] = identificadorAfd
	}
	if transitorio {
		payload["transitorio"] = true
	}
	corpo, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	respBytes, status, err := c.chamar(http.MethodPost, "/api/rep/v1/pendencias", corpo)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("falha ao confirmar cadastro (HTTP %d): %s", status, string(respBytes))
	}
	return nil
}

// ReportarBiometria envia os identificador_afd (formato 12 dígitos) que atualmente têm
// biometria cadastrada no relógio — só liga a flag do lado do SisEscala, nunca desliga (ver
// fn_atualizar_biometria_vinculos). Casa por identificador_afd, não por um "id" de device que
// esta linha de equipamento não expõe (confirmado 12/08/2026, ver rep/client.go).
func (c *Client) ReportarBiometria(identificadoresAfd []string) error {
	corpo, err := json.Marshal(map[string]interface{}{"identificadores_afd": identificadoresAfd})
	if err != nil {
		return err
	}

	respBytes, status, err := c.chamar(http.MethodPost, "/api/rep/v1/biometria", corpo)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("falha ao reportar biometria (HTTP %d): %s", status, string(respBytes))
	}
	return nil
}

// UsuarioDispositivoRelato é o que o coletor manda em /api/rep/v1/usuarios-dispositivo — o
// snapshot completo de quem está cadastrado no relógio agora (Fase 7b, higiene de cadastros de
// outro sistema, 12/08/2026).
type UsuarioDispositivoRelato struct {
	IdentificadorAFD  string `json:"identificador_afd"`
	RegistrationBruto string `json:"registration_bruto,omitempty"`
	Nome              string `json:"nome,omitempty"`
	TemBiometria      bool   `json:"tem_biometria"`
}

// ReportarUsuariosDispositivo envia o snapshot inteiro de load_users.fcgi — o SisEscala
// substitui por completo o que tinha antes para este dispositivo (fn_registrar_snapshot_usuarios_dispositivo).
func (c *Client) ReportarUsuariosDispositivo(usuarios []UsuarioDispositivoRelato) (jsonResumo []byte, err error) {
	corpo, err := json.Marshal(map[string]interface{}{"usuarios": usuarios})
	if err != nil {
		return nil, err
	}

	respBytes, status, err := c.chamar(http.MethodPost, "/api/rep/v1/usuarios-dispositivo", corpo)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("falha ao reportar usuarios do dispositivo (HTTP %d): %s", status, string(respBytes))
	}
	return respBytes, nil
}

// RemocaoPendente é um item da fila de remoção (Fase 7b) — quem foi selecionado na tela de
// higiene para sair do relógio.
type RemocaoPendente struct {
	FilaID           string `json:"fila_id"`
	IdentificadorAFD string `json:"identificador_afd"`
	NomeNoDevice     string `json:"nome_no_device"`
}

// ListarRemocoesPendentes busca a fila de remoção de usuário deste dispositivo.
func (c *Client) ListarRemocoesPendentes() ([]RemocaoPendente, error) {
	respBytes, status, err := c.chamar(http.MethodGet, "/api/rep/v1/remocoes", nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("falha ao listar remocoes pendentes (HTTP %d): %s", status, string(respBytes))
	}

	var pendentes []RemocaoPendente
	if err := json.Unmarshal(respBytes, &pendentes); err != nil {
		return nil, fmt.Errorf("resposta invalida do SisEscala: %s", string(respBytes))
	}
	return pendentes, nil
}

// ConfirmarRemocao reporta o resultado de uma remoção — sucesso ou falha com o motivo.
// Idempotente: reenviar a confirmação de um item já processado não faz nada.
func (c *Client) ConfirmarRemocao(filaID string, sucesso bool, mensagemErro string) error {
	payload := map[string]interface{}{"fila_id": filaID, "sucesso": sucesso}
	if mensagemErro != "" {
		payload["erro"] = mensagemErro
	}
	corpo, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	respBytes, status, err := c.chamar(http.MethodPost, "/api/rep/v1/remocoes", corpo)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("falha ao confirmar remocao (HTTP %d): %s", status, string(respBytes))
	}
	return nil
}

// Heartbeat reporta a hora do relógio do device para o SisEscala calcular a deriva.
// relogioDevice nil quando o coletor não conseguiu ler o relógio do REP — o heartbeat ainda
// vale para atualizar ultimo_contato_em, só não atualiza deriva_segundos.
func (c *Client) Heartbeat(relogioDevice *time.Time) error {
	payload := map[string]interface{}{}
	if relogioDevice != nil {
		payload["relogio_device"] = relogioDevice.Format(time.RFC3339)
	}
	corpo, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	respBytes, status, err := c.chamar(http.MethodPost, "/api/rep/v1/heartbeat", corpo)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("falha no heartbeat (HTTP %d): %s", status, string(respBytes))
	}
	return nil
}
