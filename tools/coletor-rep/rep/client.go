// Package rep fala com o relógio de ponto Control iD (REP-C) via as rotas .fcgi do próprio
// equipamento. InsecureSkipVerify é necessário porque o device usa TLS auto-assinado — o
// pinning por cert_fingerprint (quando configurado) é o que evita que isso vire "aceitar
// qualquer certificado".
//
// ⚠️ Os nomes exatos dos campos de login.fcgi/get_system_information.fcgi não foram
// confirmados contra o hardware real NESTA sessão (sem acesso ao device). O que o plano
// documenta como validado em produção (08/08/2026) é login.fcgi + get_afd.fcgi?mode=671 com
// initial_nsr incremental — o resto (nomes de campo do get_system_information) é a melhor
// aproximação da API Control iD e precisa ser confirmado com `curl.exe -sk` antes de confiar
// cegamente no parsing de rodarHeartbeat.
//
// ✅ CriarUsuario e ListarUsuariosComBiometria (Fase 7) CONFIRMADAS contra hardware real em
// 12/08/2026, depois de cinco rodadas de teste (`coletor-rep-cli cadastros-testar` contra
// 10.110.2.89): API genérica "objects" rejeitada (linha de produto errada) → comando certo
// (`add_users.fcgi`/`load_users.fcgi`) mas CPF/limit inválidos → dados reais leram certo (6
// usuários do piloto, sem campo "id", `pis`/`registration` como número) → `CriarUsuario`
// recusava CPF string → matrícula temporária (`T26xxxxx`) precisa do `T` removido (confirmado
// pelo usuário como convenção já em uso manual neste relógio). Resultado final: `CriarUsuario`
// criou um usuário de teste real; `ListarUsuariosComBiometria` achou os 5 servidores reais do
// piloto com biometria cadastrada, CPFs batendo. Segue sem entrar no ciclo automático (só
// clique manual/`cadastros`) por prudência com escrita em equipamento de produção, não por
// dúvida sobre o formato.
//
// ⚠️ ListarUsuarios (Fase 7b, higiene de cadastros, 12/08/2026) é só um refactor de
// ListarUsuariosComBiometria para devolver a lista inteira, não filtrada — reaproveita a mesma
// paginação já confirmada, então herda a confiança dela.
//
// ✅ RemoverUsuario (mesma leva) CONFIRMADA contra hardware real em 13/08/2026 (LACEM), no
// segundo formato tentado: o corpo é `{"users":[N]}` — array de NÚMEROS com o `pis`. O original
// `{"users":[{"pis":N}]}`, aproximação por simetria com load_users.fcgi, tinha sido recusado no
// mesmo dia com "'users' em formato incorreto" nas 31 remoções da fila. A varredura de candidatos
// (descobrirFormatoRemocao) fica, com o formato confirmado em primeiro: é o que faz um modelo
// diferente de relógio ser descoberto em vez de simplesmente falhar. Continua fora do ciclo
// automático e do menu da bandeja — é a única chamada que apaga dado de equipamento de produção.
package rep

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// timeoutPadrao vale para as chamadas PEQUENAS (login, get_system_information, load_users,
// add_users, remove_users): todas respondem em menos de um segundo num relogio saudavel, entao um
// timeout curto e' desejavel — e' o que faz equipamento fora do ar falhar rapido em vez de
// segurar o ciclo.
//
// timeoutAFDPadrao e' o de get_afd.fcgi, que e' outra ordem de grandeza: o equipamento monta o
// arquivo inteiro antes de responder, e num relogio reaproveitado sao dezenas de milhares de
// linhas. Os 30s que valiam para tudo eram exatamente a causa do REP iDClass - SMS nunca ter
// completado uma sincronizacao entre 14/08 e 17/08/2026. A coleta incremental (cursor de NSR)
// resolve o caso do dia a dia, mas a PRIMEIRA coleta de um relogio ja usado continua sendo o
// arquivo inteiro — e' ela que precisa deste teto folgado para o dispositivo conseguir arrancar.
const (
	timeoutPadrao    = 30 * time.Second
	timeoutAFDPadrao = 10 * time.Minute
)

type Client struct {
	baseURL string
	// httpClient serve as chamadas pequenas; httpClientAFD so' get_afd.fcgi. Compartilham o mesmo
	// Transport, entao TLS/pinning e reuso de conexao sao identicos nos dois - a unica diferenca
	// deliberada e' o Timeout.
	httpClient    *http.Client
	httpClientAFD *http.Client
	usuario       string
	senha         string
	sessao        string

	// formatoRemocao guarda qual corpo de remove_users.fcgi este equipamento aceitou nesta
	// execucao - descoberto na primeira remocao (ver descobrirFormatoRemocao) e reusado depois,
	// para nao repetir a varredura de candidatos a cada usuario do lote.
	formatoRemocao *formatoRemocao

	// formatoCadastro e o mesmo para add_users.fcgi: o nome do campo de identificador varia por
	// modelo (a SMS recusou `cpf` pedindo `pis`), entao o primeiro cadastro de cada execucao
	// descobre e o resto do lote reusa.
	formatoCadastro *formatoCadastro

	// formatoTemplate idem, para GRAVAR biometria (copia entre relogios da mesma unidade). Este e
	// o menos conhecido dos tres: nenhum candidato foi confirmado contra hardware ainda, entao a
	// varredura aqui nao e' contingencia para "outro modelo" - e' o mecanismo principal.
	formatoTemplate *formatoTemplate
}

func NovoClient(endereco string, porta int, usaHTTPS bool, usuario, senha, certFingerprint string) *Client {
	esquema := "http"
	if usaHTTPS {
		esquema = "https"
	}
	baseURL := fmt.Sprintf("%s://%s:%d", esquema, endereco, porta)

	tlsConfig := &tls.Config{InsecureSkipVerify: true} //nolint:gosec // pinning por fingerprint abaixo compensa

	if certFingerprint != "" {
		esperado := certFingerprint
		tlsConfig.VerifyPeerCertificate = func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			for _, raw := range rawCerts {
				soma := sha256.Sum256(raw)
				if hex.EncodeToString(soma[:]) == esperado {
					return nil
				}
			}
			return fmt.Errorf("certificado do REP nao confere com cert_fingerprint configurado")
		}
	}

	// IdleConnTimeout EXPLICITO. O zero-value de http.Transport significa "sem limite": a conexao
	// keep-alive ociosa nunca se fecha sozinha, e como a goroutine de leitura dela mantem o
	// Transport vivo, nem o GC a recolhe. Cada rep.Client monta o seu Transport e o ciclo cria
	// tres por rodada (Sync, Heartbeat, SincronizarCadastros), entao o processo ia acumulando
	// conexoes penduradas num equipamento que, medido em 05/09/2026, PARA DE ACEITAR conexao por
	// volta de 7-8 simultaneas. Medido em campo o acumulo nao estava ocorrendo (o proprio device
	// derruba as ociosas), mas depender disso e' contar com sorte alheia.
	transporte := &http.Transport{
		TLSClientConfig: tlsConfig,
		IdleConnTimeout: 90 * time.Second,
	}

	return &Client{
		baseURL:       baseURL,
		httpClient:    &http.Client{Timeout: timeoutPadrao, Transport: transporte},
		httpClientAFD: &http.Client{Timeout: timeoutAFDPadrao, Transport: transporte},
		usuario:       usuario,
		senha:         senha,
	}
}

// ComTimeoutAFD ajusta so' o teto de get_afd.fcgi (config `timeout_afd_segundos`). Valor <= 0
// mantem timeoutAFDPadrao — chave ausente no config.yaml nao pode virar "timeout zero", que em Go
// significaria ESPERAR PARA SEMPRE e prenderia o ciclo da bandeja num relogio travado.
func (c *Client) ComTimeoutAFD(segundos int) *Client {
	if segundos > 0 {
		c.httpClientAFD.Timeout = time.Duration(segundos) * time.Second
	}
	return c
}

func (c *Client) chamar(caminho string, payload map[string]interface{}) (map[string]interface{}, error) {
	corpo, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/"+caminho, bytes.NewReader(corpo))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var resultado map[string]interface{}
	if err := json.Unmarshal(respBytes, &resultado); err != nil {
		return nil, fmt.Errorf("resposta invalida de %s: %s", caminho, string(respBytes))
	}
	return resultado, nil
}

// Login autentica no REP-C e guarda a sessão para as próximas chamadas.
func (c *Client) Login() error {
	resultado, err := c.chamar("login.fcgi", map[string]interface{}{
		"login":    c.usuario,
		"password": c.senha,
	})
	if err != nil {
		return err
	}

	sessao, ok := resultado["session"].(string)
	if !ok || sessao == "" {
		return fmt.Errorf("login.fcgi nao devolveu sessao valida: %v", resultado)
	}
	c.sessao = sessao
	return nil
}

// GetAFD busca os registros de AFD a partir de initialNsr (inclusive). Este pacote nunca decide o
// initialNsr: no ciclo automático ele vem do cursor que o SisEscala mantém
// (fn_cursor_afd_dispositivo, via ciclo.Sync); em `afd-exportar` vem do estado local do pendrive; em
// `afd-raw` é sempre 1 de propósito, por ser diagnóstico. Usa httpClientAFD, não httpClient — ver o
// comentário dos dois timeouts no topo do arquivo.
func (c *Client) GetAFD(initialNsr int64) ([]byte, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return nil, err
		}
	}

	corpo := []byte(fmt.Sprintf(`{"mode":671,"initial_nsr":%d}`, initialNsr))
	req, err := http.NewRequest(
		http.MethodPost,
		fmt.Sprintf("%s/get_afd.fcgi?session=%s", c.baseURL, c.sessao),
		bytes.NewReader(corpo),
	)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClientAFD.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	return io.ReadAll(resp.Body)
}

// InformacoesSistema devolve o payload cru de get_system_information.fcgi — usado só para
// ler o relógio do device (deriva, no heartbeat). O coletor nunca ajusta o relógio do REP em
// silêncio: é operação legalmente registrável num REP-C, então só reporta a diferença.
func (c *Client) InformacoesSistema() (map[string]interface{}, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return nil, err
		}
	}
	return c.chamar(fmt.Sprintf("get_system_information.fcgi?session=%s", c.sessao), map[string]interface{}{})
}

// ============================================================================
// Relogio do equipamento (26/08/2026)
// ============================================================================
//
// ✅ get_system_date_time.fcgi / set_system_date_time.fcgi CONFIRMADOS contra hardware real
// (Almox-Pat-CAF-01 e 02). Achados na propria interface web do equipamento, depois de 22 chutes
// de nome (`set_time`, `set_clock`, `set_rtc`, `adjust_time`, `sync_time`, `set_ntp`, ...) darem
// todos "Invalid command" - a pagina do device referencia os .fcgi que ela usa, e ler isso e' mais
// barato que adivinhar.
//
// ⚠️ get_system_information.fcgi NAO devolve hora nenhuma. extrairRelogioDevice procurava
// `device_time`/`system_time`/`datetime` nela e por isso `dispositivos_rep.deriva_segundos` estava
// NULL nos 15 relogios do parque desde sempre: a deriva nunca foi medida, em nenhum equipamento.
//
// ⚠️ AJUSTAR O RELOGIO E' OPERACAO AUDITADA, e e' isso que a torna aceitavel. O proprio REP grava
// no AFD um registro TIPO 4 com o de -> para:
//
//	000061351 4 010120010008 260820261658 <crc>
//	            01/01/2001 00:08  ->  26/08/2026 16:58
//
// Ou seja, nao ha como um ajuste passar despercebido em fiscalizacao - o artefato legal registra
// sozinho. E' o oposto de mexer em marcacao, que continua impossivel por construcao.

// DataHoraDispositivo le o relogio interno do equipamento.
//
// Devolve time.Time no fuso LOCAL do processo: o device responde campos soltos (day/month/year/
// hour/minute/second) sem offset nenhum, entao quem le e' que decide o fuso. Local e' o certo -
// o equipamento e a maquina que o coleta estao fisicamente na mesma sala.
func (c *Client) DataHoraDispositivo() (time.Time, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return time.Time{}, err
		}
	}
	resp, err := c.chamar(fmt.Sprintf("get_system_date_time.fcgi?session=%s", c.sessao), map[string]interface{}{})
	if err != nil {
		return time.Time{}, err
	}
	if errMsg, ok := resp["error"]; ok {
		return time.Time{}, fmt.Errorf("get_system_date_time.fcgi recusou: %v", errMsg)
	}

	campo := func(nome string) (int, bool) {
		v, ok := resp[nome].(float64)
		return int(v), ok
	}
	dia, okD := campo("day")
	mes, okM := campo("month")
	ano, okA := campo("year")
	hora, okH := campo("hour")
	minuto, okMi := campo("minute")
	segundo, okS := campo("second")
	if !okD || !okM || !okA || !okH || !okMi || !okS {
		return time.Time{}, fmt.Errorf("get_system_date_time.fcgi devolveu campos inesperados: %v", resp)
	}
	return time.Date(ano, time.Month(mes), dia, hora, minuto, segundo, 0, time.Local), nil
}

// AjustarDataHoraDispositivo grava a hora no relogio interno do equipamento.
//
// ⚠️ Quem chama precisa passar uma hora CONFIAVEL. A hora crua da maquina nao serve: relogio de
// Windows torto em unidade e' problema medido em campo (foi o que gerou os 401 de anti-replay na
// SMS em 17/08/2026), e propagar esse erro para o relogio de ponto transformaria um problema de
// uma maquina em ponto errado de servidor. Ver ciclo.horaConfiavel.
func (c *Client) AjustarDataHoraDispositivo(t time.Time) error {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return err
		}
	}
	resp, err := c.chamar(fmt.Sprintf("set_system_date_time.fcgi?session=%s", c.sessao), map[string]interface{}{
		"day": t.Day(), "month": int(t.Month()), "year": t.Year(),
		"hour": t.Hour(), "minute": t.Minute(), "second": t.Second(),
	})
	if err != nil {
		return err
	}
	if errMsg, ok := resp["error"]; ok {
		return fmt.Errorf("set_system_date_time.fcgi recusou: %v", errMsg)
	}
	return nil
}

// ✅ CONFIRMADO CONTRA HARDWARE REAL em 12/08/2026 (10.110.2.89, cinco rodadas via
// `coletor-rep-cli cadastros-testar`): `add_users.fcgi` (criar) e `load_users.fcgi` (listar) sao
// os comandos certos da linha iDClass/REP-C — a linha de produto de Acesso (iDAccess/iDFlex/
// iDBlock) usa uma API "objects" genérica diferente, ja descartada. `mode=671` + campo `cpf`
// (nao `pis`) porque `get_afd.fcgi` deste device ja roda em modo 671.
//
// Descobertas que mudaram o desenho: o objeto "user" deste device NAO tem campo "id" interno -
// so `pis`/`registration`/`code`/`rfid`/`templates`, TODOS como numero JSON, nao string. Por
// isso `device_user_id` deixou de existir no modelo - a identidade de referencia e' sempre
// `pis`/`registration` (= `identificador_afd`, mesmo formato usado no sentido AFD->servidor).
// Matricula temporaria (`T26xxxxx`, CLAUDE.md) tem o `T` removido antes de virar numero -
// confirmado pelo usuario como a convencao ja em uso manual neste mesmo rele para os servidores
// temporarios ja cadastrados, nao documentada em nenhum lugar do codigo antes disso.
//
// CriarUsuario criou um usuario de teste real; ListarUsuariosComBiometria achou os 5 servidores
// reais do piloto com biometria cadastrada, CPFs batendo. Continua fora do ciclo automatico (so
// clique manual / subcomando `cadastros`) por prudencia com escrita em equipamento de producao -
// nao por duvida restante sobre o formato.

// CriarUsuario cadastra uma identidade "vazia" no rele (sem biometria - isso so acontece
// presencialmente no equipamento). identificadorAfd vem no formato de 12 digitos do AFD (CPF
// com zero de preenchimento); o campo cpf da API espera o CPF puro como NUMERO, daí o
// `right(...,11)` + conversao — a mesma operacao inversa que fn_vinculos_sugeridos_afd já faz
// do lado do banco (armadilha 10, CLAUDE.md).
// formatoCadastro e' um jeito candidato de montar o corpo de add_users.fcgi. Mesmo padrao de
// formatosRemocao: o nome do campo de identificador VARIA por modelo/firmware, e descobrir por
// tentativa confirmada e' o que faz um relogio novo ser suportado em vez de falhar em silencio.
//
// ✅ `cpf` CONFIRMADO em 12/08/2026 no REP da TI (10.110.2.89) - fica em primeiro.
// ❌ Em 17/08/2026 o REP da SMS (10.110.0.20) recusou as 327 tentativas com
//    "'pis' em formato incorreto". O device NOMEIA o campo `pis`, e pela convencao ja observada
//    duas vezes neste equipamento (ver formatosRemocao) o campo nomeado e' o que ele espera. Aquele
//    relogio veio cadastrado por PIS pelo sistema anterior, o que reforca a leitura.
//    ⚠️ NAO CONFIRMADO em hardware: rodar `coletor-rep-cli cadastros-testar` na unidade antes de
//    confiar. Se o device validar o digito verificador de PIS, mandar CPF no campo `pis` tambem
//    sera recusado - e ai o cadastro naquele relogio tera que ser por PIS de verdade.
type formatoCadastro struct {
	Nome  string
	Corpo func(nome string, matricula, numero int64) map[string]interface{}
}

var formatosCadastro = []formatoCadastro{
	{"users:[{cpf}]", func(nome string, matricula, numero int64) map[string]interface{} {
		return map[string]interface{}{"users": []map[string]interface{}{
			{"name": nome, "registration": matricula, "cpf": numero, "admin": false}}}
	}},
	{"users:[{pis}]", func(nome string, matricula, numero int64) map[string]interface{} {
		return map[string]interface{}{"users": []map[string]interface{}{
			{"name": nome, "registration": matricula, "pis": numero, "admin": false}}}
	}},
	{"users:[{pis,cpf}]", func(nome string, matricula, numero int64) map[string]interface{} {
		return map[string]interface{}{"users": []map[string]interface{}{
			{"name": nome, "registration": matricula, "pis": numero, "cpf": numero, "admin": false}}}
	}},
}

// FormatoCadastroUsado devolve o nome do formato de add_users.fcgi que este equipamento aceitou
// nesta execucao (vazio se nenhum cadastro rodou ainda) - so' para log/diagnostico.
func (c *Client) FormatoCadastroUsado() string {
	if c.formatoCadastro == nil {
		return ""
	}
	return c.formatoCadastro.Nome
}

// CriarUsuario devolve o identificador_afd que o RELOGIO passou a ter para esta pessoa, lido de
// volta por relistagem - nao o que mandamos. E' esse numero que aparece na marcacao do AFD, entao
// e' ele que precisa virar rep_vinculos_servidor; calcular do CPF foi o que produziria 327 vinculos
// que nunca casariam nada no relogio da SMS. Devolve "" quando nao foi possivel reler (o servidor
// entao cai no calculo por CPF, correto nos relogios cadastrados por CPF).
func (c *Client) CriarUsuario(matricula, nome, identificadorAfd string) (string, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return "", err
		}
	}

	// Matricula temporaria (formato TYYNNNNN, CLAUDE.md) tem o "T" removido antes de virar
	// numero - NAO documentado em lugar nenhum do codigo/planos, confirmado pelo usuario
	// (12/08/2026) como o que ja foi feito na mao para os servidores ja cadastrados neste
	// mesmo rele. Replica a convencao ja em uso, nao inventa uma nova.
	matriculaLimpa := strings.TrimPrefix(strings.ToUpper(matricula), "T")
	matriculaNum, err := strconv.ParseInt(matriculaLimpa, 10, 64)
	if err != nil {
		return "", fmt.Errorf("matricula %q (sem prefixo: %q) nao e numerica - este rele so aceita "+
			"'registration' numerico: %w", matricula, matriculaLimpa, err)
	}

	cpfStr := identificadorAfd
	if len(cpfStr) > 11 {
		cpfStr = cpfStr[len(cpfStr)-11:]
	}
	cpfNum, err := strconv.ParseInt(cpfStr, 10, 64)
	if err != nil {
		return "", fmt.Errorf("identificador_afd %q nao produziu um cpf numerico valido: %w", identificadorAfd, err)
	}

	// Formato ja descoberto nesta execucao: dispara direto, sem relistar por usuario (relistagem
	// pagina de 100 em 100; fazer isso 327 vezes seria absurdo).
	if c.formatoCadastro != nil {
		return "", c.aplicarCadastro(*c.formatoCadastro, nome, matriculaNum, cpfNum)
	}
	return c.descobrirFormatoCadastro(nome, matriculaNum, cpfNum)
}

// aplicarCadastro dispara um formato ja conhecido. Erro aqui e' so' o que o equipamento recusou.
func (c *Client) aplicarCadastro(f formatoCadastro, nome string, matricula, numero int64) error {
	resultado, err := c.chamar(
		fmt.Sprintf("add_users.fcgi?session=%s&mode=671", c.sessao),
		f.Corpo(nome, matricula, numero))
	if err != nil {
		return err
	}
	if errMsg, ok := resultado["error"]; ok {
		return fmt.Errorf("add_users.fcgi recusou (formato %s): %v", f.Nome, errMsg)
	}
	return nil
}

// descobrirFormatoCadastro tenta cada candidato ate um deles REALMENTE criar o usuario, conferindo
// por relistagem. "Sem erro" do equipamento nao basta: um formato pode ser aceito e nao criar nada,
// e ai o SisEscala marcaria a fila como enviada com o relogio vazio.
//
// Devolve o identificador_afd que o relogio atribuiu, lido da relistagem - o dado que faz o vinculo
// casar com o AFD depois.
func (c *Client) descobrirFormatoCadastro(nome string, matricula, numero int64) (string, error) {
	var tentativas []string
	for _, f := range formatosCadastro {
		if err := c.aplicarCadastro(f, nome, matricula, numero); err != nil {
			tentativas = append(tentativas, fmt.Sprintf("%s -> %v", f.Nome, err))
			continue
		}

		usuarios, err := c.ListarUsuarios()
		if err != nil {
			return "", fmt.Errorf("formato %s foi aceito pelo rele mas nao foi possivel reler o "+
				"cadastro para confirmar o efeito - confira na interface do equipamento: %w", f.Nome, err)
		}
		for _, u := range usuarios {
			if u.RegistrationConh && u.Registration == matricula {
				formato := f
				c.formatoCadastro = &formato
				return u.IdentificadorAFD, nil
			}
		}
		tentativas = append(tentativas, fmt.Sprintf("%s -> aceito mas o usuario nao apareceu na relistagem", f.Nome))
	}

	return "", fmt.Errorf("nenhum formato de add_users.fcgi funcionou neste equipamento; tentativas: %s",
		strings.Join(tentativas, " | "))
}

// UsuarioDispositivo é um usuário como veio de load_users.fcgi, sem filtro de biometria - base
// da higiene de cadastros (Fase 7b, 12/08/2026): o rele chega usado por outro sistema antes do
// SisEscala, com usuarios que podem nao fazer mais parte do quadro. RegistrationBruto fica como
// veio do device (string, mesmo sendo numero na API) porque aqui e' so' para exibicao/auditoria -
// nunca vira identidade de referencia (essa continua sendo IdentificadorAFD, ver armadilha 10).
// Pis/Code/Registration ficam como numeros porque sao o que a API do device aceita de volta
// (remove_users.fcgi) - o rele nao tem campo "id", entao a identidade tem que sair de um destes.
type UsuarioDispositivo struct {
	IdentificadorAFD  string
	RegistrationBruto string
	Nome              string
	TemBiometria      bool

	Pis              int64
	Code             int64
	CodeConhecido    bool
	Registration     int64
	RegistrationConh bool

	// Templates sao os templates biometricos COMO O EQUIPAMENTO OS DEVOLVEU (load_users.fcgi ja
	// e chamado com `templates: true` desde 12/08/2026 - ate a v0.9.1 so' o TAMANHO deste array
	// era usado, para responder "tem biometria?", e o conteudo era descartado).
	//
	// ⚠️ Repassados crus, sem decodificar nem reserializar: e' container proprietario de
	// biometria, e a unica coisa que faz uma copia entre equipamentos ter chance de funcionar e'
	// devolver exatamente o que veio. Mesmo principio de linha_bruta no AFD.
	Templates []interface{}
}

// ListarUsuarios devolve TODOS os usuarios cadastrados no rele agora (load_users.fcgi), nao so'
// quem tem biometria - ListarUsuariosComBiometria (abaixo) e' um filtro em cima deste. Casa por
// `pis`, nao por um "id" que este device nao tem (ver aviso acima).
func (c *Client) ListarUsuarios() ([]UsuarioDispositivo, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return nil, err
		}
	}

	// Documentado: limit maximo 100 por chamada - "1000" de uma vez foi o que provavelmente
	// causou o HTTP 400 anterior (a mensagem de erro do rele nao nomeia o campo). Pagina ate a
	// pagina voltar com menos que o limite.
	const tamanhoPagina = 100
	var usuarios []UsuarioDispositivo
	var totalUsuarios int
	var semPisReconhecivel int
	var amostra interface{}

	for offset := 0; ; offset += tamanhoPagina {
		resultado, err := c.chamar(fmt.Sprintf("load_users.fcgi?session=%s", c.sessao), map[string]interface{}{
			"limit": tamanhoPagina, "offset": offset, "templates": true,
		})
		if err != nil {
			return nil, err
		}

		lista, ok := resultado["users"].([]interface{})
		if !ok {
			return nil, fmt.Errorf("load_users.fcgi resposta inesperada: %v", resultado)
		}

		for _, item := range lista {
			totalUsuarios++
			if amostra == nil {
				amostra = item
			}
			m, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			// pis vem como numero JSON - CPF que comeca com zero perde esse zero na
			// serializacao (ex.: CPF 08943857128 -> pis 8943857128, 10 digitos). %012d
			// devolve exatamente o formato de 12 digitos de identificador_afd (armadilha 10).
			pis, ok := m["pis"].(float64)
			if !ok {
				semPisReconhecivel++
				continue
			}

			var registrationBruto string
			var registration int64
			registrationConh := false
			if reg, ok := m["registration"].(float64); ok {
				registration = int64(reg)
				registrationBruto = strconv.FormatInt(registration, 10)
				registrationConh = true
			}
			var code int64
			codeConhecido := false
			if cd, ok := m["code"].(float64); ok {
				code = int64(cd)
				codeConhecido = true
			}
			nome, _ := m["name"].(string)
			templates, _ := m["templates"].([]interface{})

			usuarios = append(usuarios, UsuarioDispositivo{
				IdentificadorAFD:  fmt.Sprintf("%012d", int64(pis)),
				RegistrationBruto: registrationBruto,
				Nome:              nome,
				TemBiometria:      len(templates) > 0,
				Templates:         templates,
				Pis:               int64(pis),
				Code:              code,
				CodeConhecido:     codeConhecido,
				Registration:      registration,
				RegistrationConh:  registrationConh,
			})
		}

		if len(lista) < tamanhoPagina {
			break
		}
	}

	if totalUsuarios > 0 && semPisReconhecivel == totalUsuarios {
		return nil, fmt.Errorf(
			"load_users.fcgi devolveu %d usuario(s) mas nenhum com campo 'pis' reconhecivel - "+
				"o nome do campo de identificador pode ser outro (modo 671 usa 'cpf'?). Exemplo cru: %v",
			totalUsuarios, amostra)
	}
	return usuarios, nil
}

// ListarUsuariosComBiometria devolve os identificador_afd (formato de 12 digitos, mesma
// convencao de rep_vinculos_servidor) dos usuarios que tem pelo menos um template biometrico
// cadastrado no rele - usado para fechar o loop de "pendencias de biometria" sem exigir que
// ninguem digite nada no SisEscala manualmente. `templates: true` no pedido pede ao rele para
// incluir o array de templates biometricos na resposta (confirmado: array vazio = sem
// biometria).
func (c *Client) ListarUsuariosComBiometria() ([]string, error) {
	usuarios, err := c.ListarUsuarios()
	if err != nil {
		return nil, err
	}
	var identificadores []string
	for _, u := range usuarios {
		if u.TemBiometria {
			identificadores = append(identificadores, u.IdentificadorAFD)
		}
	}
	return identificadores, nil
}

// formatoRemocao e' um jeito candidato de montar o corpo de remove_users.fcgi. O formato certo
// deste device NAO e' conhecido a priori (ver descobrirFormatoRemocao abaixo), entao o cliente
// tenta os candidatos em ordem uma unica vez por processo e guarda o que o equipamento aceitou.
//
// Corpo devolve (nil,false) quando o candidato nao se aplica aquele usuario (ex.: o rele nao
// devolveu `code` para ele) - candidato pulado, nao contado como falha.
type formatoRemocao struct {
	Nome  string
	Mode  bool
	Corpo func(u UsuarioDispositivo) (map[string]interface{}, bool)
}

// Ordem deliberada, do CONFIRMADO para o hipotetico:
//
// ✅ `users:[pis]` (array de NUMEROS, nao de objetos) CONFIRMADO contra hardware real em
// 13/08/2026 na LACEM: removeu o usuario de teste e a relistagem provou que so' ele saiu do
// cadastro. Fica em primeiro para que a remocao real nunca comece experimentando candidato em
// cima de cadastro de servidor — o resto da lista so' e' alcancado num equipamento onde este
// formato falhar (outro modelo/firmware), que e' o caso para o qual a descoberta existe.
//
// A pista que levou ate ele: a recusa das 31 remocoes no mesmo dia foi
// "'users' em formato incorreto" — o device NOMEIA o campo `users`, nao um campo interno do
// objeto. Compare com "'cpf' em formato incorreto" (12/08/2026, CriarUsuario com CPF de digito
// verificador invalido), onde o campo nomeado era o de dentro do objeto. Era o TIPO dos elementos
// que estava errado, e a confirmacao em campo bateu com isso.
var formatosRemocao = []formatoRemocao{
	{"users:[pis]", true, func(u UsuarioDispositivo) (map[string]interface{}, bool) {
		return map[string]interface{}{"users": []interface{}{u.Pis}}, true
	}},
	{"users:[code]", true, func(u UsuarioDispositivo) (map[string]interface{}, bool) {
		if !u.CodeConhecido {
			return nil, false
		}
		return map[string]interface{}{"users": []interface{}{u.Code}}, true
	}},
	{"users:[registration]", true, func(u UsuarioDispositivo) (map[string]interface{}, bool) {
		if !u.RegistrationConh {
			return nil, false
		}
		return map[string]interface{}{"users": []interface{}{u.Registration}}, true
	}},
	{"users:[{code}]", true, func(u UsuarioDispositivo) (map[string]interface{}, bool) {
		if !u.CodeConhecido {
			return nil, false
		}
		return map[string]interface{}{"users": []map[string]interface{}{{"code": u.Code}}}, true
	}},
	{"users:[{cpf}]", true, func(u UsuarioDispositivo) (map[string]interface{}, bool) {
		// mode=671 usa `cpf` na criacao (add_users.fcgi) para o mesmo numero que load_users.fcgi
		// devolve como `pis` - vale tentar a mesma troca de nome na remocao.
		return map[string]interface{}{"users": []map[string]interface{}{{"cpf": u.Pis}}}, true
	}},
	{"users:[{pis}]", true, func(u UsuarioDispositivo) (map[string]interface{}, bool) {
		// Formato original (12/08/2026), REPROVADO contra hardware real em 13/08/2026 neste
		// modelo. Fica por ultimo, so' para outro equipamento que porventura espere objeto.
		return map[string]interface{}{"users": []map[string]interface{}{{"pis": u.Pis}}}, true
	}},
	{"users:[pis] (sem mode)", false, func(u UsuarioDispositivo) (map[string]interface{}, bool) {
		return map[string]interface{}{"users": []interface{}{u.Pis}}, true
	}},
}

// RemoverUsuario tira um usuario do rele (remove_users.fcgi).
//
// O formato aceito por este modelo e' `users:[pis]`, confirmado em campo (ver a lista acima) - e'
// o primeiro candidato tentado. A primeira remocao de cada processo ainda passa por
// descobrirFormatoRemocao, que CONFIRMA por relistagem que o cadastro realmente saiu antes de
// fixar o formato; da segunda em diante o formato ja esta em cache no cliente. Isso e' o que
// permite ligar o coletor num modelo/firmware diferente sem descobrir o problema em cima de
// cadastro de servidor.
//
// Recebe o usuario inteiro (como veio de ListarUsuarios), nao so' o identificador, porque os
// candidatos precisam de `code`/`registration`, que so' existem no snapshot do device.
func (c *Client) RemoverUsuario(u UsuarioDispositivo) error {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return err
		}
	}

	if c.formatoRemocao == nil {
		return c.descobrirFormatoRemocao(u)
	}
	return c.aplicarRemocao(*c.formatoRemocao, u)
}

// aplicarRemocao dispara um formato ja conhecido, sem relistar. Erro aqui e' so' o que o proprio
// equipamento recusou - a conferencia de que o cadastro realmente saiu e' feita uma vez so, no
// fim do lote (ciclo.HigienizarRemocoes), para nao paginar load_users.fcgi por usuario.
func (c *Client) aplicarRemocao(f formatoRemocao, u UsuarioDispositivo) error {
	corpo, aplicavel := f.Corpo(u)
	if !aplicavel {
		return fmt.Errorf("formato %s nao se aplica a %s (o rele nao devolveu os campos necessarios)", f.Nome, u.IdentificadorAFD)
	}

	caminho := fmt.Sprintf("remove_users.fcgi?session=%s", c.sessao)
	if f.Mode {
		caminho += "&mode=671"
	}
	resultado, err := c.chamar(caminho, corpo)
	if err != nil {
		return err
	}
	if errMsg, ok := resultado["error"]; ok {
		return fmt.Errorf("remove_users.fcgi recusou (formato %s): %v", f.Nome, errMsg)
	}
	return nil
}

// FormatoRemocaoUsado devolve o nome do formato de remove_users.fcgi que este equipamento
// aceitou nesta execucao (vazio se nenhuma remocao rodou ainda) - so' para log/diagnostico, e o
// que permite fixar o formato no codigo depois de uma validacao em campo.
func (c *Client) FormatoRemocaoUsado() string {
	if c.formatoRemocao == nil {
		return ""
	}
	return c.formatoRemocao.Nome
}

// descobrirFormatoRemocao tenta cada candidato ate um deles REALMENTE apagar o cadastro alvo,
// conferindo por relistagem completa antes e depois. Um "sem erro" do equipamento nao basta: um
// formato pode ser aceito e nao remover nada (foi o que a aproximacao original teria mascarado se
// o rele tivesse respondido 200).
//
// A conferencia e' por diferenca de conjunto, nao so' "o alvo sumiu": se um formato apagar quem
// nao devia (ex.: o numero enviado for interpretado como outro campo e casar com outro usuario),
// isso e' descoberto na hora e a operacao inteira aborta com erro explicito, em vez de continuar
// varrendo cadastro alheio.
func (c *Client) descobrirFormatoRemocao(alvo UsuarioDispositivo) error {
	antes, err := c.ListarUsuarios()
	if err != nil {
		return fmt.Errorf("nao foi possivel ler o cadastro do rele antes de remover (a remocao nao "+
			"e tentada as cegas): %w", err)
	}

	var tentativas []string
	for _, f := range formatosRemocao {
		corpo, aplicavel := f.Corpo(alvo)
		if !aplicavel {
			continue
		}

		caminho := fmt.Sprintf("remove_users.fcgi?session=%s", c.sessao)
		if f.Mode {
			caminho += "&mode=671"
		}
		resultado, err := c.chamar(caminho, corpo)
		if err != nil {
			tentativas = append(tentativas, fmt.Sprintf("%s -> erro de transporte: %v", f.Nome, err))
			continue
		}
		if errMsg, ok := resultado["error"]; ok {
			tentativas = append(tentativas, fmt.Sprintf("%s -> recusado: %v", f.Nome, errMsg))
			continue
		}

		depois, err := c.ListarUsuarios()
		if err != nil {
			return fmt.Errorf("formato %s foi aceito pelo rele mas nao foi possivel reler o cadastro "+
				"para confirmar o efeito - pare e confira na interface do equipamento: %w", f.Nome, err)
		}

		sumiram := identificadoresAusentes(antes, depois)
		if len(sumiram) == 1 && sumiram[0] == alvo.IdentificadorAFD {
			formato := f
			c.formatoRemocao = &formato
			return nil
		}
		if len(sumiram) > 0 {
			return fmt.Errorf("PARE: o formato %s removeu %d cadastro(s) que nao eram o alvo %s (%v). "+
				"Nenhuma outra remocao sera tentada nesta execucao - confira o cadastro do equipamento",
				f.Nome, len(sumiram), alvo.IdentificadorAFD, sumiram)
		}
		tentativas = append(tentativas, fmt.Sprintf("%s -> aceito mas nao removeu nada", f.Nome))
	}

	return fmt.Errorf("nenhum formato de remove_users.fcgi funcionou neste equipamento; tentativas: %s",
		strings.Join(tentativas, " | "))
}

// identificadoresAusentes devolve quem estava em `antes` e nao esta mais em `depois`.
func identificadoresAusentes(antes, depois []UsuarioDispositivo) []string {
	presentes := make(map[string]bool, len(depois))
	for _, u := range depois {
		presentes[u.IdentificadorAFD] = true
	}
	var ausentes []string
	for _, u := range antes {
		if !presentes[u.IdentificadorAFD] {
			ausentes = append(ausentes, u.IdentificadorAFD)
		}
	}
	return ausentes
}

// ============================================================================
// Copia de biometria entre relogios da mesma unidade
// ============================================================================
//
// 🚨 NENHUM formato abaixo foi confirmado contra hardware real. Diferente de add_users.fcgi
// (confirmado 12/08/2026) e remove_users.fcgi (confirmado 13/08/2026), aqui a varredura NAO e'
// contingencia para um modelo diferente - e' o mecanismo principal, e a primeira execucao em
// campo e' quem descobre. Por isso:
//
//   * `coletor-rep-cli biometria-testar` existe e deve ser rodado ANTES, contra o descartavel
//     "SISESCALA TESTE - PODE APAGAR", com um dedo cadastrado nele de proposito. Nenhum dado de
//     servidor real se move nesse teste.
//   * a copia real NAO entra no ciclo automatico enquanto ninguem confirmar em campo (ver
//     cmd/tray: item de menu, clique manual).
//
// O que pode dar errado, e o motivo das duas conferencias em descobrirFormatoTemplate:
//   1. um formato ser aceito e nao gravar nada (o "ok" do device ja provou nao ser prova, na
//      remocao, em 13/08/2026);
//   2. um formato CRIAR um usuario novo em vez de atualizar o existente - o alvo ficaria com
//      digital no cadastro errado e o equipamento com cadastro duplicado.

type formatoTemplate struct {
	Nome    string
	Caminho string
	Mode    bool
	// Corpo devolve (corpo, aplicavel). Nao-aplicavel e' candidato pulado, nao falha - ex.: o
	// equipamento nao devolveu `registration` para aquele usuario.
	Corpo func(u UsuarioDispositivo, templates []interface{}) (map[string]interface{}, bool)
}

// Ordem: do mais provavel para o menos. Mudou em 26/08/2026, no piloto de multiplos relogios
// (Almox-Pat-CAF-01 -> CAF-02), que e a primeira vez que esta operacao rodou em campo.
//
// ✅ update_users.fcgi CONFIRMADO CONTRA HARDWARE REAL (26/08/2026). O caso testado e
// exatamente o do dia a dia: a pessoa ja estava no relogio de destino SEM digital (criada pela
// fila de identidade) e recebeu a digital que ja tinha no outro relogio da unidade. As tres
// condicoes foram conferidas por relistagem: a digital chegou no alvo, SO o alvo ganhou
// digital, e o cadastro nao cresceu nem encolheu.
//
// ⚠️ add_users.fcgi NAO serve para esta operacao, e esse foi o achado que destravou tudo: ele e
// CRIACAO, nao atualizacao. Nas 45 copias que falharam as 15:48 daquele dia ele respondeu
// "PIS ja cadastrado: <n>" - nunca foi recusa de FORMATO, era recusa de duplicidade. Contra
// alguem que ja esta no relogio (que e sempre o caso desta operacao, que por regra nunca cria
// usuario) ele nao tem como funcionar. Fica na lista abaixo do confirmado porque a mensagem
// dele e diagnostica e porque um firmware sem update_users pode aceita-lo.
//
// ⚠️ add_templates.fcgi e set_templates.fcgi NAO EXISTEM neste firmware ("Invalid command",
// sondados um a um com corpo vazio, que nao escreve nada). Ficam por ultimo, para outro modelo.
//
// 🚨 NAO acrescente candidato que mande `templates` SEM `name`/`registration`. Se um firmware
// tratar update_users como substituicao do objeto inteiro, o cadastro perde nome e matricula -
// e a conferencia por relistagem NAO pegaria isso: ela olha biometria e tamanho do cadastro,
// nao os campos de quem ficou. Um candidato desses existiu aqui por algumas horas em
// 26/08/2026 e foi removido antes de rodar em cima de cadastro real.
var formatosTemplate = []formatoTemplate{
	{"update_users:[{pis,name,registration,templates}]", "update_users.fcgi", true,
		func(u UsuarioDispositivo, t []interface{}) (map[string]interface{}, bool) {
			return map[string]interface{}{"users": []map[string]interface{}{{
				"name": u.Nome, "pis": u.Pis, "registration": u.Registration, "templates": t,
			}}}, u.RegistrationConh
		}},
	{"update_users:[{pis,name,registration,templates}] (sem mode)", "update_users.fcgi", false,
		func(u UsuarioDispositivo, t []interface{}) (map[string]interface{}, bool) {
			return map[string]interface{}{"users": []map[string]interface{}{{
				"name": u.Nome, "pis": u.Pis, "registration": u.Registration, "templates": t,
			}}}, u.RegistrationConh
		}},
	{"add_users:[{pis,templates}]", "add_users.fcgi", true,
		func(u UsuarioDispositivo, t []interface{}) (map[string]interface{}, bool) {
			return map[string]interface{}{"users": []map[string]interface{}{{
				"name": u.Nome, "pis": u.Pis, "registration": u.Registration, "templates": t,
			}}}, u.RegistrationConh
		}},
	{"add_users:[{cpf,templates}]", "add_users.fcgi", true,
		func(u UsuarioDispositivo, t []interface{}) (map[string]interface{}, bool) {
			return map[string]interface{}{"users": []map[string]interface{}{{
				"name": u.Nome, "cpf": u.Pis, "registration": u.Registration, "templates": t,
			}}}, u.RegistrationConh
		}},
	{"add_templates:[{pis,template}]", "add_templates.fcgi", true,
		func(u UsuarioDispositivo, t []interface{}) (map[string]interface{}, bool) {
			itens := make([]map[string]interface{}, 0, len(t))
			for _, tpl := range t {
				itens = append(itens, map[string]interface{}{"pis": u.Pis, "template": tpl})
			}
			return map[string]interface{}{"templates": itens}, len(itens) > 0
		}},
	{"add_templates:[{user_id,template}]", "add_templates.fcgi", true,
		func(u UsuarioDispositivo, t []interface{}) (map[string]interface{}, bool) {
			if !u.CodeConhecido {
				return nil, false
			}
			itens := make([]map[string]interface{}, 0, len(t))
			for _, tpl := range t {
				itens = append(itens, map[string]interface{}{"user_id": u.Code, "template": tpl})
			}
			return map[string]interface{}{"templates": itens}, len(itens) > 0
		}},
	{"set_templates:[{pis,template}]", "set_templates.fcgi", true,
		func(u UsuarioDispositivo, t []interface{}) (map[string]interface{}, bool) {
			itens := make([]map[string]interface{}, 0, len(t))
			for _, tpl := range t {
				itens = append(itens, map[string]interface{}{"pis": u.Pis, "template": tpl})
			}
			return map[string]interface{}{"templates": itens}, len(itens) > 0
		}},
	{"add_users:[{pis,templates}] (sem mode)", "add_users.fcgi", false,
		func(u UsuarioDispositivo, t []interface{}) (map[string]interface{}, bool) {
			return map[string]interface{}{"users": []map[string]interface{}{{
				"name": u.Nome, "pis": u.Pis, "registration": u.Registration, "templates": t,
			}}}, u.RegistrationConh
		}},
}

// FormatoTemplateUsado devolve qual candidato de escrita de biometria este equipamento aceitou
// nesta execucao (vazio se nenhuma copia rodou) - e' o que o teste de campo precisa reportar
// para o formato poder ser fixado no codigo depois.
func (c *Client) FormatoTemplateUsado() string {
	if c.formatoTemplate == nil {
		return ""
	}
	return c.formatoTemplate.Nome
}

// GravarTemplates escreve no relogio os templates biometricos de alguem que JA ESTA cadastrado
// nele sem digital. Devolve o nome do formato aceito.
//
// Nao cria usuario: se o alvo nao estiver no equipamento, isso e assunto da fila de identidade
// (rep_cadastros_fila), que ja existe e ja roda no ciclo. Uma peca, uma responsabilidade - e e'
// o que garante que esta operacao nunca duplique cadastro.
func (c *Client) GravarTemplates(alvo UsuarioDispositivo, templates []interface{}) (string, error) {
	if len(templates) == 0 {
		return "", fmt.Errorf("nenhum template para gravar em %s", alvo.IdentificadorAFD)
	}
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return "", err
		}
	}

	if c.formatoTemplate != nil {
		return c.formatoTemplate.Nome, c.aplicarTemplate(*c.formatoTemplate, alvo, templates)
	}
	return c.descobrirFormatoTemplate(alvo, templates)
}

func (c *Client) aplicarTemplate(f formatoTemplate, alvo UsuarioDispositivo, templates []interface{}) error {
	corpo, aplicavel := f.Corpo(alvo, templates)
	if !aplicavel {
		return fmt.Errorf("formato %s nao se aplica a %s (o rele nao devolveu os campos necessarios)",
			f.Nome, alvo.IdentificadorAFD)
	}

	caminho := fmt.Sprintf("%s?session=%s", f.Caminho, c.sessao)
	if f.Mode {
		caminho += "&mode=671"
	}
	resultado, err := c.chamar(caminho, corpo)
	if err != nil {
		return err
	}
	if errMsg, ok := resultado["error"]; ok {
		return fmt.Errorf("%s recusou (formato %s): %v", f.Caminho, f.Nome, errMsg)
	}
	return nil
}

// descobrirFormatoTemplate tenta os candidatos ate um deles REALMENTE gravar a digital do alvo,
// confirmando por relistagem completa antes e depois.
//
// Duas conferencias, e nenhuma pode sair:
//
//   - **so' o alvo pode ganhar biometria.** Se outro usuario aparecer com digital que nao tinha,
//     a execucao inteira aborta: o numero enviado foi interpretado como outro campo e casou com
//     outra pessoa, e continuar seria espalhar a digital de alguem pelo cadastro alheio.
//   - **o cadastro nao pode crescer.** Um formato que "funciona" criando usuario novo em vez de
//     atualizar o existente deixa o equipamento com cadastro duplicado e a digital no registro
//     errado - passaria pela primeira conferencia e seria pior que a falha.
func (c *Client) descobrirFormatoTemplate(alvo UsuarioDispositivo, templates []interface{}) (string, error) {
	antes, err := c.ListarUsuarios()
	if err != nil {
		return "", fmt.Errorf("nao foi possivel ler o cadastro do rele antes de gravar a biometria "+
			"(a gravacao nao e tentada as cegas): %w", err)
	}

	var tentativas []string
	for _, f := range formatosTemplate {
		corpo, aplicavel := f.Corpo(alvo, templates)
		if !aplicavel {
			continue
		}

		caminho := fmt.Sprintf("%s?session=%s", f.Caminho, c.sessao)
		if f.Mode {
			caminho += "&mode=671"
		}
		resultado, err := c.chamar(caminho, corpo)
		if err != nil {
			tentativas = append(tentativas, fmt.Sprintf("%s -> erro de transporte: %v", f.Nome, err))
			continue
		}
		if errMsg, ok := resultado["error"]; ok {
			tentativas = append(tentativas, fmt.Sprintf("%s -> recusado: %v", f.Nome, errMsg))
			continue
		}

		depois, err := c.ListarUsuarios()
		if err != nil {
			return "", fmt.Errorf("formato %s foi aceito pelo rele mas nao foi possivel reler o "+
				"cadastro para confirmar o efeito - pare e confira na interface do equipamento: %w",
				f.Nome, err)
		}

		if len(depois) > len(antes) {
			return "", fmt.Errorf("PARE: o formato %s CRIOU cadastro no equipamento (%d -> %d usuarios) "+
				"em vez de gravar a digital em %s. Nenhum outro formato sera tentado - confira o "+
				"cadastro do relogio e apague o que sobrou", f.Nome, len(antes), len(depois), alvo.IdentificadorAFD)
		}

		// A direcao contraria, e ela e pior: um formato que APAGA cadastro. Sem esta conferencia o
		// caso cai em "aceito mas nao gravou nada" logo abaixo e a varredura segue tentando os
		// proximos candidatos em cima de um relogio que acabou de perder usuario. Vale para o alvo
		// e para qualquer outro: identificadoresAusentes (ja usada pela remocao) diz exatamente quem
		// sumiu, porque "quantos" nao basta para ir atras do estrago.
		if sumiram := identificadoresAusentes(antes, depois); len(sumiram) > 0 {
			return "", fmt.Errorf("PARE: o formato %s APAGOU %d cadastro(s) do equipamento (%d -> %d "+
				"usuarios; sumiram: %v) em vez de gravar a digital em %s. Nenhum outro formato sera "+
				"tentado - confira o cadastro do relogio antes de qualquer outra coisa",
				f.Nome, len(sumiram), len(antes), len(depois), sumiram, alvo.IdentificadorAFD)
		}

		ganharam := ganharamBiometria(antes, depois)
		if len(ganharam) == 1 && ganharam[0] == alvo.IdentificadorAFD {
			formato := f
			c.formatoTemplate = &formato
			return f.Nome, nil
		}
		if len(ganharam) > 0 {
			return "", fmt.Errorf("PARE: o formato %s gravou biometria em %d cadastro(s) que nao eram "+
				"o alvo %s (%v). Nenhum outro formato sera tentado - confira o cadastro do equipamento",
				f.Nome, len(ganharam), alvo.IdentificadorAFD, ganharam)
		}
		tentativas = append(tentativas, fmt.Sprintf("%s -> aceito mas nao gravou nada", f.Nome))
	}

	return "", fmt.Errorf("nenhum formato de gravacao de biometria funcionou neste equipamento; "+
		"tentativas: %s", strings.Join(tentativas, " | "))
}

// ganharamBiometria devolve quem NAO tinha digital em `antes` e passou a ter em `depois`.
func ganharamBiometria(antes, depois []UsuarioDispositivo) []string {
	tinha := make(map[string]bool, len(antes))
	for _, u := range antes {
		tinha[u.IdentificadorAFD] = u.TemBiometria
	}
	var ganharam []string
	for _, u := range depois {
		if u.TemBiometria && !tinha[u.IdentificadorAFD] {
			ganharam = append(ganharam, u.IdentificadorAFD)
		}
	}
	return ganharam
}
