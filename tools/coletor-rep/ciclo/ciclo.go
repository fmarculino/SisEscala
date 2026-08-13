// Package ciclo é o "fazer um sync" e "fazer um heartbeat" — extraído de cmd/cli para que
// cmd/tray rode exatamente a mesma lógica em loop, sem duplicar código entre os dois binários.
package ciclo

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/sms-maraba/sisescala-coletor-rep/config"
	"github.com/sms-maraba/sisescala-coletor-rep/fila"
	"github.com/sms-maraba/sisescala-coletor-rep/rep"
	"github.com/sms-maraba/sisescala-coletor-rep/sisescala"
)

const Versao = "0.4.3"

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "desconhecido"
	}
	return h
}

// loteIDDeterministico gera um identificador em formato UUID (8-4-4-4-12 hex) a partir do
// conteúdo do lote. rep_sincronizacoes.lote_id é uuid NOT NULL, e precisa ser ESTÁVEL entre
// reenvios do mesmo lote — é isso que faz fn_ingerir_afd tratar reenvio como no-op.
func loteIDDeterministico(dispositivoID string, linhas []string) string {
	h := sha256.New()
	h.Write([]byte(dispositivoID))
	for _, l := range linhas {
		h.Write([]byte(l))
	}
	soma := h.Sum(nil)
	return fmt.Sprintf("%x-%x-%x-%x-%x", soma[0:4], soma[4:6], soma[6:8], soma[8:10], soma[10:16])
}

// Sync reenvia primeiro o que ficou na fila offline, depois busca o AFD novo do relógio.
func Sync(cfg *config.Config) error {
	if cfg.DispositivoRep == nil {
		return fmt.Errorf("secao dispositivo_rep ausente no config.yaml — nada para sincronizar")
	}
	d := cfg.DispositivoRep
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)

	// Reenvio de fila é sempre seguro: fn_ingerir_afd é idempotente por (dispositivo_id, lote_id).
	pendentes, err := fila.Pendentes(cfg.Fila.Diretorio)
	if err != nil {
		log.Printf("aviso: falha ao ler fila offline: %v", err)
	}
	for _, lote := range pendentes {
		resultado, err := sc.EnviarLote(lote.LoteID, lote.Linhas, lote.ArquivoSHA256, Versao, hostname())
		if err != nil {
			log.Printf("lote %s continua na fila: %v", lote.LoteID, err)
			continue
		}
		log.Printf("lote %s da fila reenviado: novas=%d duplicadas=%d marcacoes=%d orfas=%d",
			lote.LoteID, resultado.Novas, resultado.Duplicadas, resultado.Marcacoes, resultado.Orfas)
		if err := fila.Remover(cfg.Fila.Diretorio, lote.LoteID); err != nil {
			log.Printf("aviso: nao foi possivel remover lote %s da fila apos ACK: %v", lote.LoteID, err)
		}
	}

	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	// TODO(operacional): o "ultimo NSR aceito" vive no SisEscala (dispositivos_rep.ultimo_nsr),
	// nao neste binario. Esta primeira versao sempre pede a partir do NSR 1 e deixa a
	// idempotencia de fn_ingerir_afd (UNIQUE dispositivo_id+nsr) descartar o que ja foi
	// ingerido — funciona, mas reenvia o arquivo inteiro do relogio a cada ciclo. Antes de
	// ligar em producao com relogios de alto volume, troque por uma leitura previa do
	// ultimo_nsr (nova rota GET, ou consulta direta) para pedir so o incremento.
	bruto, err := rc.GetAFD(1)
	if err != nil {
		return fmt.Errorf("falha ao buscar AFD do relogio: %w", err)
	}

	afdUTF8, err := rep.DecodificarLatin1(bruto)
	if err != nil {
		return fmt.Errorf("falha ao decodificar AFD (latin1): %w", err)
	}

	linhas := rep.DividirLinhas(afdUTF8)
	if len(linhas) == 0 {
		log.Println("nenhuma linha no AFD")
		return nil
	}

	arquivoSHA256 := rep.SHA256Hex(bruto)
	const tamanhoLote = 500
	for inicio := 0; inicio < len(linhas); inicio += tamanhoLote {
		fim := inicio + tamanhoLote
		if fim > len(linhas) {
			fim = len(linhas)
		}
		trecho := linhas[inicio:fim]
		loteID := loteIDDeterministico(d.ID, trecho)

		resultado, err := sc.EnviarLote(loteID, trecho, arquivoSHA256, Versao, hostname())
		if err != nil {
			log.Printf("falha ao enviar lote %s, gravando na fila offline: %v", loteID, err)
			erroFila := fila.Gravar(cfg.Fila.Diretorio, fila.Lote{
				LoteID: loteID, Linhas: trecho, ArquivoSHA256: arquivoSHA256,
				ColetorVersao: Versao, ColetorHost: hostname(),
			})
			if erroFila != nil {
				log.Printf("erro: falha tambem ao gravar na fila: %v", erroFila)
			}
			continue
		}
		log.Printf("lote %s: novas=%d duplicadas=%d marcacoes=%d orfas=%d nsr_max_aceito=%d",
			loteID, resultado.Novas, resultado.Duplicadas, resultado.Marcacoes, resultado.Orfas, resultado.NsrMaxAceito)
	}
	return nil
}

// Heartbeat reporta versão e deriva de relógio. Devolve erro só quando a chamada ao SisEscala
// falha — não saber a hora do relógio (get_system_information sem campo reconhecido) não é
// erro, só segue sem deriva.
func Heartbeat(cfg *config.Config) error {
	if cfg.DispositivoRep == nil {
		return fmt.Errorf("secao dispositivo_rep ausente no config.yaml")
	}
	d := cfg.DispositivoRep
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)

	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)
	info, err := rc.InformacoesSistema()
	if err != nil {
		log.Printf("aviso: nao foi possivel ler o relogio do REP (%v); heartbeat sem deriva", err)
		return sc.Heartbeat(nil)
	}

	relogioDevice := extrairRelogioDevice(info)
	if relogioDevice.IsZero() {
		log.Println("aviso: get_system_information.fcgi nao trouxe um campo de hora reconhecido; heartbeat sem deriva")
		return sc.Heartbeat(nil)
	}
	return sc.Heartbeat(&relogioDevice)
}

// SincronizarCadastros aplica a fila de push de identidade (Fase 7) no relógio e reporta quem
// já tem biometria cadastrada lá. Deliberadamente NUNCA chamada pelo ciclo automático de
// executarCiclo (cmd/tray) — só por clique manual no menu ou pelo subcomando de diagnóstico da
// CLI. rep.CriarUsuario/ListarUsuariosComBiometria não foram validadas contra hardware real
// (ver aviso em rep/client.go); rodar isso sozinho de tempos em tempos escreveria no relógio
// de produção com um formato de campo ainda não confirmado.
// ResultadoCadastros resume o que aconteceu num SincronizarCadastros - usado pela bandeja
// (cmd/tray/main.go) para compor a notificacao final com numeros, em vez de um "ok"/"falhou" seco.
type ResultadoCadastros struct {
	Pendentes int
	Enviados  int
	Falhas    int
}

func SincronizarCadastros(cfg *config.Config) (ResultadoCadastros, error) {
	var resultado ResultadoCadastros
	if cfg.DispositivoRep == nil {
		return resultado, fmt.Errorf("secao dispositivo_rep ausente no config.yaml — nada para sincronizar")
	}
	d := cfg.DispositivoRep
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	pendentes, err := sc.ListarCadastrosPendentes()
	if err != nil {
		return resultado, fmt.Errorf("falha ao listar cadastros pendentes: %w", err)
	}
	resultado.Pendentes = len(pendentes)
	log.Printf("cadastros: %d pendente(s) para enviar ao rele", len(pendentes))

	for _, p := range pendentes {
		// device_user_id sempre nil - confirmado em 12/08/2026 que este device nao expoe um id
		// interno separado (so pis/registration). A identidade de referencia e' identificador_afd,
		// ja gravado em fn_confirmar_cadastro_rep a partir do proprio servidor da fila.
		if err := rc.CriarUsuario(p.Matricula, p.Nome, p.IdentificadorAFD); err != nil {
			resultado.Falhas++
			log.Printf("cadastro de %s (%s) falhou: %v", p.Nome, p.Matricula, err)
			if erroConfirmar := sc.ConfirmarCadastro(p.FilaID, false, nil, err.Error()); erroConfirmar != nil {
				log.Printf("aviso: falha tambem ao reportar erro do cadastro %s: %v", p.FilaID, erroConfirmar)
			}
			continue
		}
		resultado.Enviados++
		log.Printf("cadastro de %s (%s) criado no rele", p.Nome, p.Matricula)
		if err := sc.ConfirmarCadastro(p.FilaID, true, nil, ""); err != nil {
			log.Printf("aviso: cadastro %s criado no rele mas falha ao confirmar no SisEscala: %v", p.FilaID, err)
		}
	}

	comBiometria, err := rc.ListarUsuariosComBiometria()
	if err != nil {
		log.Printf("aviso: nao foi possivel listar biometria do rele: %v", err)
		return resultado, nil // envio de cadastros ja aconteceu - nao falha o ciclo por isso
	}
	if err := sc.ReportarBiometria(comBiometria); err != nil {
		log.Printf("aviso: falha ao reportar biometria ao SisEscala: %v", err)
	}
	return resultado, nil
}

// HigienizarListagem lê TODOS os usuários cadastrados no relógio (load_users.fcgi) e reporta o
// snapshot ao SisEscala — a base da tela de higiene (Fase 7b, 12/08/2026): um relógio usado
// antes por outro sistema chega com cadastros de gente que pode não fazer mais parte do quadro.
// Só LEITURA no equipamento (mesma chamada já confirmada contra hardware real em
// ListarUsuariosComBiometria) — segura de rodar a qualquer momento, diferente de
// HigienizarRemocoes abaixo.
// ResultadoHigiene resume o que aconteceu num HigienizarListagem - usado pela bandeja para
// compor a notificacao final com numero de usuarios, em vez de um "ok"/"falhou" seco.
type ResultadoHigiene struct {
	UsuariosLidos int
}

func HigienizarListagem(cfg *config.Config) (ResultadoHigiene, error) {
	var resultado ResultadoHigiene
	if cfg.DispositivoRep == nil {
		return resultado, fmt.Errorf("secao dispositivo_rep ausente no config.yaml — nada para higienizar")
	}
	d := cfg.DispositivoRep
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	usuarios, err := rc.ListarUsuarios()
	if err != nil {
		return resultado, fmt.Errorf("falha ao listar usuarios do rele: %w", err)
	}
	resultado.UsuariosLidos = len(usuarios)
	log.Printf("higiene: %d usuario(s) lido(s) do rele", len(usuarios))

	relato := make([]sisescala.UsuarioDispositivoRelato, len(usuarios))
	for i, u := range usuarios {
		relato[i] = sisescala.UsuarioDispositivoRelato{
			IdentificadorAFD: u.IdentificadorAFD, RegistrationBruto: u.RegistrationBruto,
			Nome: u.Nome, TemBiometria: u.TemBiometria,
		}
	}
	resumo, err := sc.ReportarUsuariosDispositivo(relato)
	if err != nil {
		return resultado, fmt.Errorf("falha ao reportar usuarios ao SisEscala: %w", err)
	}
	log.Printf("higiene: snapshot reportado ao SisEscala — %s", string(resumo))
	return resultado, nil
}

// HigienizarRemocoes aplica no relógio quem foi selecionado na tela de higiene (Fase 7b) para
// sair do equipamento. Deliberadamente NUNCA chamada pelo ciclo automático nem pelo menu da
// bandeja: é a única operação que apaga dado de equipamento de produção, e o formato aceito por
// remove_users.fcgi neste hardware só foi descoberto por tentativa (ver rep/client.go).
//
// Só reporta sucesso ao SisEscala depois de RELISTAR o cadastro do relógio e confirmar que o
// usuário sumiu de verdade. O device já respondeu "ok" para chamada que não removeu nada, e
// marcar a fila como aplicada nesse caso deixaria o SisEscala achando que o relógio está limpo
// quando não está.
func HigienizarRemocoes(cfg *config.Config) error {
	if cfg.DispositivoRep == nil {
		return fmt.Errorf("secao dispositivo_rep ausente no config.yaml — nada para remover")
	}
	d := cfg.DispositivoRep
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	pendentes, err := sc.ListarRemocoesPendentes()
	if err != nil {
		return fmt.Errorf("falha ao listar remocoes pendentes: %w", err)
	}
	log.Printf("higiene: %d remocao(oes) pendente(s) para aplicar no rele", len(pendentes))
	if len(pendentes) == 0 {
		return nil
	}

	// O corpo de remove_users.fcgi precisa de campos que só existem no snapshot do equipamento
	// (`code`/`registration`), não na fila do SisEscala — daí ler o cadastro antes de remover.
	usuarios, err := rc.ListarUsuarios()
	if err != nil {
		return fmt.Errorf("falha ao ler o cadastro do rele antes de remover: %w", err)
	}
	noDevice := make(map[string]rep.UsuarioDispositivo, len(usuarios))
	for _, u := range usuarios {
		noDevice[u.IdentificadorAFD] = u
	}

	// tentados = quem o equipamento aceitou remover; a confirmação ao SisEscala só sai depois da
	// relistagem final.
	tentados := make([]sisescala.RemocaoPendente, 0, len(pendentes))
	for _, p := range pendentes {
		alvo, existe := noDevice[p.IdentificadorAFD]
		if !existe {
			// Já não está no relógio (removido na mão pela interface do equipamento, ou por uma
			// execução anterior). Fila fechada com sucesso — é o estado que se queria.
			log.Printf("usuario %s (%s) ja nao esta cadastrado no rele — fila fechada sem nova remocao",
				p.NomeNoDevice, p.IdentificadorAFD)
			if err := sc.ConfirmarRemocao(p.FilaID, true, ""); err != nil {
				log.Printf("aviso: falha ao confirmar remocao %s no SisEscala: %v", p.FilaID, err)
			}
			continue
		}

		if err := rc.RemoverUsuario(alvo); err != nil {
			log.Printf("remocao de %s (%s) falhou: %v", p.NomeNoDevice, p.IdentificadorAFD, err)
			if erroConfirmar := sc.ConfirmarRemocao(p.FilaID, false, err.Error()); erroConfirmar != nil {
				log.Printf("aviso: falha tambem ao reportar erro da remocao %s: %v", p.FilaID, erroConfirmar)
			}
			// Erro de formato desconhecido vale para todo o lote: sem formato aceito, insistir nos
			// 30 seguintes só repete a mesma varredura de candidatos contra o equipamento.
			if rc.FormatoRemocaoUsado() == "" {
				return fmt.Errorf("nenhuma remocao foi aplicada: %w", err)
			}
			continue
		}
		tentados = append(tentados, p)
	}

	if len(tentados) == 0 {
		return nil
	}
	log.Printf("higiene: %d remocao(oes) aceitas pelo rele (formato %s) — conferindo por relistagem",
		len(tentados), rc.FormatoRemocaoUsado())

	depois, err := rc.ListarUsuarios()
	if err != nil {
		return fmt.Errorf("remocoes aplicadas, mas falha ao reler o cadastro do rele para confirmar "+
			"(nada foi confirmado no SisEscala; rodar de novo e' seguro): %w", err)
	}
	aindaNoDevice := make(map[string]bool, len(depois))
	for _, u := range depois {
		aindaNoDevice[u.IdentificadorAFD] = true
	}

	var removidos, sobraram int
	for _, p := range tentados {
		if aindaNoDevice[p.IdentificadorAFD] {
			sobraram++
			msg := "o rele aceitou a remocao mas o cadastro continua la (conferido por relistagem)"
			log.Printf("remocao de %s (%s): %s", p.NomeNoDevice, p.IdentificadorAFD, msg)
			if err := sc.ConfirmarRemocao(p.FilaID, false, msg); err != nil {
				log.Printf("aviso: falha ao reportar remocao nao efetivada %s: %v", p.FilaID, err)
			}
			continue
		}
		removidos++
		log.Printf("usuario %s (%s) removido do rele", p.NomeNoDevice, p.IdentificadorAFD)
		if err := sc.ConfirmarRemocao(p.FilaID, true, ""); err != nil {
			log.Printf("aviso: usuario %s removido do rele mas falha ao confirmar no SisEscala: %v", p.FilaID, err)
		}
	}
	log.Printf("higiene: %d removido(s), %d nao efetivado(s)", removidos, sobraram)

	// O snapshot da tela fica desatualizado depois de remover — reportar aqui evita ter que
	// lembrar de rodar `higiene` logo em seguida.
	relato := make([]sisescala.UsuarioDispositivoRelato, len(depois))
	for i, u := range depois {
		relato[i] = sisescala.UsuarioDispositivoRelato{
			IdentificadorAFD: u.IdentificadorAFD, RegistrationBruto: u.RegistrationBruto,
			Nome: u.Nome, TemBiometria: u.TemBiometria,
		}
	}
	if _, err := sc.ReportarUsuariosDispositivo(relato); err != nil {
		log.Printf("aviso: remocoes aplicadas, mas falha ao atualizar o snapshot no SisEscala: %v", err)
	}
	return nil
}

// InfoVersaoServidor é o que GET /api/coletor-rep/tray-version devolve.
type InfoVersaoServidor struct {
	Versao string `json:"versao"`
	SHA256 string `json:"sha256"`
}

// VersaoDisponivel confere no SisEscala se existe uma versão do coletor-rep-tray mais nova que a
// instalada (Versao, const no topo deste arquivo). Chamada PÚBLICA, sem HMAC de dispositivo — o
// binário não carrega segredo nenhum, e precisa funcionar mesmo numa máquina só com
// terminal_local configurado (sem dispositivo_rep, que é quem tem token). Nunca aplica nada
// sozinha — só informa; quem decide baixar e trocar o executável é o clique no menu da bandeja
// (`cmd/tray/main.go`), nunca este ciclo automático.
func VersaoDisponivel(cfg *config.Config) (InfoVersaoServidor, bool, error) {
	var info InfoVersaoServidor

	resp, err := http.Get(strings.TrimRight(cfg.SisEscala.URL, "/") + "/api/coletor-rep/tray-version")
	if err != nil {
		return info, false, fmt.Errorf("falha ao consultar versao no SisEscala: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return info, false, fmt.Errorf("SisEscala respondeu %d ao consultar versao", resp.StatusCode)
	}

	corpo, err := io.ReadAll(resp.Body)
	if err != nil {
		return info, false, fmt.Errorf("falha ao ler resposta de versao: %w", err)
	}
	if err := json.Unmarshal(corpo, &info); err != nil {
		// A resposta esperada e' sempre JSON, mesmo nos caminhos de erro da rota
		// (/api/coletor-rep/tray-version so devolve corpo nao-JSON se algo na frente da aplicacao
		// - proxy/deploy em andamento - responder no lugar dela). Amostra do corpo cru e' o que
		// falta pra diferenciar isso de um bug na rota na proxima vez que isso acontecer.
		amostra := string(corpo)
		if len(amostra) > 200 {
			amostra = amostra[:200]
		}
		return info, false, fmt.Errorf("resposta de versao invalida (HTTP %d, corpo: %q): %w", resp.StatusCode, amostra, err)
	}

	return info, compararVersoes(info.Versao, Versao) > 0, nil
}

// BaixarNovaVersao baixa o .exe do servidor para um arquivo temporário e confere o sha256 contra
// o que VersaoDisponivel informou — download corrompido ou incompleto nunca chega a ser
// instalado. Quem troca o executável de verdade (rename do atual + copia do novo + relançar) é
// `cmd/tray/main.go`, que já tem esse padrão pronto (`autoInstalarERelancar`); esta função só
// entrega o arquivo baixado e verificado.
func BaixarNovaVersao(cfg *config.Config, sha256Esperado string) (string, error) {
	resp, err := http.Get(strings.TrimRight(cfg.SisEscala.URL, "/") + "/api/coletor-rep/tray-download")
	if err != nil {
		return "", fmt.Errorf("falha ao baixar nova versao: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("SisEscala respondeu %d ao baixar nova versao", resp.StatusCode)
	}

	dados, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("falha ao ler download: %w", err)
	}

	if sha256Esperado != "" && rep.SHA256Hex(dados) != sha256Esperado {
		return "", fmt.Errorf("sha256 do download nao confere com o esperado - descartado")
	}

	arquivoTemp, err := os.CreateTemp("", "coletor-rep-tray-novo-*.exe")
	if err != nil {
		return "", fmt.Errorf("falha ao criar arquivo temporario: %w", err)
	}
	defer arquivoTemp.Close()

	if _, err := arquivoTemp.Write(dados); err != nil {
		return "", fmt.Errorf("falha ao gravar arquivo temporario: %w", err)
	}

	return arquivoTemp.Name(), nil
}

// compararVersoes devolve >0 se a for mais nova que b, 0 se iguais, <0 se a for mais antiga.
// Versoes em formato "X.Y.Z" - compara numericamente cada parte, nao como string, senao
// "0.10.0" perderia de "0.9.0" na comparacao lexicografica.
func compararVersoes(a, b string) int {
	pa := strings.Split(a, ".")
	pb := strings.Split(b, ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		na, nb := 0, 0
		if i < len(pa) {
			na, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			nb, _ = strconv.Atoi(pb[i])
		}
		if na != nb {
			return na - nb
		}
	}
	return 0
}

// extrairRelogioDevice tenta os nomes de campo mais prováveis da API Control iD. Não
// confirmado contra hardware real ainda — ver aviso no topo de rep/client.go.
func extrairRelogioDevice(info map[string]interface{}) time.Time {
	for _, chave := range []string{"device_time", "system_time", "datetime"} {
		if v, ok := info[chave].(string); ok {
			if t, err := time.Parse(time.RFC3339, v); err == nil {
				return t
			}
		}
	}
	return time.Time{}
}
