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

const Versao = "0.11.1"

// LimiteCadastrosPorCiclo e' o teto do ciclo AUTOMATICO. O clique manual no menu passa 0 (sem
// teto, envia todos).
const LimiteCadastrosPorCiclo = 20

// LimiteRemocoesPorCiclo e' o teto de remocoes do ciclo AUTOMATICO. O clique manual no menu passa 0.
const LimiteRemocoesPorCiclo = 20

func Hostname() string {
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

// cursorDeColeta decide de qual NSR pedir o AFD nesta rodada.
//
// A fonte de verdade é SEMPRE o SisEscala (`fn_cursor_afd_dispositivo` via GET /api/rep/v1/estado)
// — é o único lado que sabe o que de fato foi ingerido. O cache local só entra quando o servidor
// está inacessível, exatamente o momento em que a fila offline existe para juntar dado: sem ele, um
// servidor fora do ar rebaixaria a coleta para "arquivo inteiro" justamente num relógio onde o
// arquivo inteiro é o que não cabe no timeout.
//
// Toda falha de decisão cai para o NSR 1, ou seja para o comportamento antigo: baixar demais.
// Errar para cima (pedir NSR maior que o devido) seria a única forma de PERDER marcação, porque o
// relógio simplesmente não devolveria as linhas anteriores e nada no sistema reclamaria — a
// assimetria é deliberada.
func cursorDeColeta(cfg *config.Config, sc *sisescala.Client, dispositivoID string) int64 {
	estado, err := sc.EstadoIngestao()
	if err == nil {
		if erroCache := fila.GravarCursor(cfg.Fila.Diretorio, dispositivoID, estado.ProximoNsr); erroCache != nil {
			log.Printf("aviso: falha ao gravar cursor local (segue normal, so' perde o fallback offline): %v", erroCache)
		}
		ultimo := "nenhum"
		if estado.UltimoNsr != nil {
			ultimo = strconv.FormatInt(*estado.UltimoNsr, 10)
		}
		log.Printf("cursor do SisEscala: pedindo AFD a partir do NSR %d (ultimo ingerido: %s)",
			estado.ProximoNsr, ultimo)
		return estado.ProximoNsr
	}

	if local, ok := fila.LerCursor(cfg.Fila.Diretorio, dispositivoID); ok {
		log.Printf("aviso: nao foi possivel consultar o cursor no SisEscala (%v); usando o ultimo "+
			"conhecido localmente: NSR %d", err, local)
		return local
	}

	log.Printf("aviso: nao foi possivel consultar o cursor no SisEscala (%v) e nao ha cursor local; "+
		"pedindo o AFD inteiro a partir do NSR 1", err)
	return 1
}

// Sync reenvia primeiro o que ficou na fila offline, depois busca o AFD novo do relógio.
func Sync(cfg *config.Config, d *config.DispositivoRepConfig) error {
	if d == nil {
		return fmt.Errorf("nenhum relogio informado para sincronizar")
	}
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)

	// Reenvio de fila é sempre seguro: fn_ingerir_afd é idempotente por (dispositivo_id, lote_id).
	pendentes, err := fila.Pendentes(cfg.Fila.Diretorio, d.ID)
	if err != nil {
		log.Printf("aviso: falha ao ler fila offline: %v", err)
	}
	// Uma fila grande com o servidor recusando tudo (token, desvio de relogio, aplicacao fora do
	// ar) nao pode consumir o ciclo inteiro: falha sistematica nao muda no 900o lote, e o ciclo
	// longo trava o menu da bandeja, que divide uma goroutine so com ele. Depois de algumas falhas
	// SEGUIDAS o resto fica para o proximo ciclo - a fila e' persistente, nada se perde. Mesmo
	// raciocinio que HigienizarRemocoes ja usa para formato de remocao desconhecido.
	const falhasSeguidasParaDesistir = 3
	var falhasSeguidas int

	for i, lote := range pendentes {
		resultado, err := sc.EnviarLote(lote.LoteID, lote.Linhas, lote.ArquivoSHA256, Versao, Hostname())
		if err != nil {
			log.Printf("lote %s continua na fila: %v", lote.LoteID, err)
			falhasSeguidas++
			if falhasSeguidas >= falhasSeguidasParaDesistir {
				log.Printf("desistindo do reenvio da fila neste ciclo apos %d falhas seguidas: "+
					"%d lote(s) continuam na fila para o proximo ciclo", falhasSeguidas, len(pendentes)-i-1)
				break
			}
			continue
		}
		falhasSeguidas = 0
		log.Printf("lote %s da fila reenviado: novas=%d duplicadas=%d marcacoes=%d orfas=%d",
			lote.LoteID, resultado.Novas, resultado.Duplicadas, resultado.Marcacoes, resultado.Orfas)
		if err := fila.Remover(cfg.Fila.Diretorio, d.ID, lote.LoteID); err != nil {
			log.Printf("aviso: nao foi possivel remover lote %s da fila apos ACK: %v", lote.LoteID, err)
		}
	}

	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint).
		ComTimeoutAFD(d.TimeoutAfdSegundos)

	// Coleta INCREMENTAL. Antes desta versao o coletor pedia sempre a partir do NSR 1 e confiava
	// na idempotencia de fn_ingerir_afd para descartar o repetido — funcionava, mas fazia o
	// equipamento remontar o arquivo inteiro a cada 5 minutos. Em relogio reaproveitado (dezenas
	// de milhares de linhas) isso deixou de ser desperdicio e passou a ser falha total: o REP
	// iDClass - SMS ficou de 14/08 a 17/08/2026 com ZERO sincronizacoes, todo ciclo morrendo em
	// "context deadline exceeded ... while reading body".
	//
	// O cursor e' do SisEscala (fn_cursor_afd_dispositivo), NAO deste binario: e' o fim do trecho
	// contiguo de NSR ja ingerido + 1, entao lacuna no meio puxa o cursor para tras em vez de
	// deixar um NSR para sempre atras. Ver a migration 20260817150000.
	proximoNsr := cursorDeColeta(cfg, sc, d.ID)

	bruto, err := rc.GetAFD(proximoNsr)
	if err != nil {
		return fmt.Errorf("falha ao buscar AFD do relogio a partir do NSR %d: %w", proximoNsr, err)
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

	log.Printf("AFD recebido a partir do NSR %d: %d linha(s), %d bytes", proximoNsr, len(linhas), len(bruto))

	// sha256 do que foi RECEBIDO nesta transferencia. Com coleta incremental isso deixa de ser o
	// sha do arquivo completo do relogio e passa a ser o do trecho — que e' o que faz sentido
	// registrar em rep_sincronizacoes.arquivo_sha256: a procedencia do artefato transferido. A
	// integridade do dado em si nao depende disso; ela vive na cadeia de hash por NSR de
	// rep_afd_registros, que e' continua entre sincronizacoes.
	arquivoSHA256 := rep.SHA256Hex(bruto)
	const tamanhoLote = 500
	for inicio := 0; inicio < len(linhas); inicio += tamanhoLote {
		fim := inicio + tamanhoLote
		if fim > len(linhas) {
			fim = len(linhas)
		}
		trecho := linhas[inicio:fim]
		loteID := loteIDDeterministico(d.ID, trecho)

		resultado, err := sc.EnviarLote(loteID, trecho, arquivoSHA256, Versao, Hostname())
		if err != nil {
			log.Printf("falha ao enviar lote %s, gravando na fila offline: %v", loteID, err)
			erroFila := fila.Gravar(cfg.Fila.Diretorio, d.ID, fila.Lote{
				LoteID: loteID, Linhas: trecho, ArquivoSHA256: arquivoSHA256,
				ColetorVersao: Versao, ColetorHost: Hostname(),
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
// ResultadoHeartbeat separa as duas conexoes que um heartbeat atravessa: esta maquina -> RELOGIO
// e esta maquina -> SISESCALA. Ate a v0.11.0 as duas viravam um erro so, e quem olhava a bandeja
// nao tinha como saber qual caiu. Com varios equipamentos por maquina isso passou a importar: o
// normal agora e tres relogios respondendo e um mudo, e o agregado escondia exatamente esse caso.
//
// ⚠️ RelogioOK e falso APENAS quando o equipamento nao respondeu. Um relogio que responde mas nao
// devolve hora reconhecivel continua ONLINE - a deriva e que fica desconhecida.
type ResultadoHeartbeat struct {
	RelogioOK   bool
	ErroRelogio error
}

// Heartbeat mantem a assinatura antiga (usada pela CLI) e delega.
func Heartbeat(cfg *config.Config, d *config.DispositivoRepConfig) error {
	_, err := HeartbeatComEstado(cfg, d)
	return err
}

// HeartbeatComEstado reporta versao e deriva, e diz de quebra se o EQUIPAMENTO respondeu.
//
// Falar com o SisEscala mesmo com o relogio mudo e deliberado e nao mudou: e assim que a tela
// mostra "coletor vivo, relogio fora do ar" em vez de simplesmente parar de receber noticia -
// os dois modos de falha sao diferentes e o silencio nao distingue um do outro.
func HeartbeatComEstado(cfg *config.Config, d *config.DispositivoRepConfig) (ResultadoHeartbeat, error) {
	var estado ResultadoHeartbeat
	if d == nil {
		return estado, fmt.Errorf("nenhum relogio informado para o heartbeat")
	}
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)

	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)
	info, err := rc.InformacoesSistema()
	if err != nil {
		log.Printf("aviso: nao foi possivel ler o relogio do REP (%v); heartbeat sem deriva", err)
		estado.ErroRelogio = err
		return estado, sc.Heartbeat(nil, Versao, Hostname())
	}
	estado.RelogioOK = true

	relogioDevice := extrairRelogioDevice(info)
	if relogioDevice.IsZero() {
		log.Println("aviso: get_system_information.fcgi nao trouxe um campo de hora reconhecido; heartbeat sem deriva")
		return estado, sc.Heartbeat(nil, Versao, Hostname())
	}
	return estado, sc.Heartbeat(&relogioDevice, Versao, Hostname())
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

// SincronizarCadastros envia a fila de identidade ao relógio. `limite` = 0 significa sem teto.
func SincronizarCadastros(cfg *config.Config, d *config.DispositivoRepConfig, limite int) (ResultadoCadastros, error) {
	var resultado ResultadoCadastros
	if d == nil {
		return resultado, fmt.Errorf("nenhum relogio informado para sincronizar cadastros")
	}
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	pendentes, err := sc.ListarCadastrosPendentes()
	if err != nil {
		return resultado, fmt.Errorf("falha ao listar cadastros pendentes: %w", err)
	}
	resultado.Pendentes = len(pendentes)

	// Teto por execucao. O ciclo da bandeja e o menu dividem UMA goroutine (cmd/tray/main.go):
	// escrever 327 cadastros de uma vez deixaria o menu sem resposta por minutos, que foi
	// exatamente o susto de 17/08/2026 com a fila de AFD inflada. A fila e persistente, entao o
	// resto sai no ciclo seguinte sem perder nada.
	if limite > 0 && len(pendentes) > limite {
		log.Printf("cadastros: %d pendente(s); enviando %d neste ciclo, o resto no proximo",
			len(pendentes), limite)
		pendentes = pendentes[:limite]
	} else {
		log.Printf("cadastros: %d pendente(s) para enviar ao rele", len(pendentes))
	}

	for _, p := range pendentes {
		// device_user_id sempre nil - confirmado em 12/08/2026 que este device nao expoe um id
		// interno separado (so pis/registration). A identidade de referencia e' identificador_afd.
		identNoDevice, err := rc.CriarUsuario(p.Matricula, p.Nome, p.IdentificadorAFD)
		if err != nil {
			resultado.Falhas++
			log.Printf("cadastro de %s (%s) falhou: %v", p.Nome, p.Matricula, err)
			// Nao alcancar o relogio NAO pode queimar o cadastro da pessoa: transitorio devolve o
			// item para a fila com espera. Recusa do equipamento e' definitiva - insistir a cada
			// ciclo repetiria o mesmo erro (foi o caso das 327 da SMS, 'pis' em formato incorreto).
			transitorio := ehFalhaDeTransporte(err)
			if erroConfirmar := sc.ConfirmarCadastro(p.FilaID, false, nil, err.Error(), "", transitorio); erroConfirmar != nil {
				log.Printf("aviso: falha tambem ao reportar erro do cadastro %s: %v", p.FilaID, erroConfirmar)
			}
			continue
		}
		resultado.Enviados++
		log.Printf("cadastro de %s (%s) criado no rele (formato %s, identificador no device: %q)",
			p.Nome, p.Matricula, rc.FormatoCadastroUsado(), identNoDevice)
		if err := sc.ConfirmarCadastro(p.FilaID, true, nil, "", identNoDevice, false); err != nil {
			log.Printf("aviso: cadastro %s criado no rele mas falha ao confirmar no SisEscala: %v", p.FilaID, err)
		}
	}

	// Relata o snapshot INTEIRO, nao so quem tem biometria. Esta listagem sempre foi feita aqui (a
	// antiga ReportarBiometria a jogava fora depois de filtrar), e e' ela que deixa o SisEscala
	// re-resolver identidade por CPF **ou** PIS via fn_registrar_snapshot_usuarios_dispositivo -
	// a fonte unica. E' o que torna o fluxo autocorretivo: mesmo que o identificador reportado no
	// ConfirmarCadastro acima falte, o snapshot conserta em seguida.
	usuarios, err := rc.ListarUsuarios()
	if err != nil {
		log.Printf("aviso: nao foi possivel listar usuarios do rele: %v", err)
		return resultado, nil // envio de cadastros ja aconteceu - nao falha o ciclo por isso
	}

	relato := make([]sisescala.UsuarioDispositivoRelato, len(usuarios))
	comBiometria := make([]string, 0, len(usuarios))
	for i, u := range usuarios {
		relato[i] = sisescala.UsuarioDispositivoRelato{
			IdentificadorAFD: u.IdentificadorAFD, RegistrationBruto: u.RegistrationBruto,
			Nome: u.Nome, TemBiometria: u.TemBiometria,
		}
		if u.TemBiometria {
			comBiometria = append(comBiometria, u.IdentificadorAFD)
		}
	}
	if _, err := sc.ReportarUsuariosDispositivo(relato); err != nil {
		log.Printf("aviso: falha ao atualizar o snapshot no SisEscala: %v", err)
	}
	if err := sc.ReportarBiometria(comBiometria); err != nil {
		log.Printf("aviso: falha ao reportar biometria ao SisEscala: %v", err)
	}
	return resultado, nil
}

// ehFalhaDeTransporte separa "nao consegui falar com o relogio" de "o relogio respondeu e recusou".
// A distincao decide o destino do item na fila, e por isso e' conservadora: SO trata como
// transitorio o que reconhece como transporte. Qualquer duvida vira falha definitiva, que e o
// comportamento antigo e aparece na tela - o oposto (achar que uma recusa e transitoria) faria o
// ciclo automatico bater no mesmo erro para sempre.
func ehFalhaDeTransporte(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	// "recusou" e' a marca das mensagens que o proprio equipamento devolveu (aplicarCadastro).
	if strings.Contains(msg, "recusou") {
		return false
	}
	for _, marca := range []string{
		"timeout", "deadline exceeded", "connection refused", "no such host",
		"network is unreachable", "connection reset", "i/o timeout", "eof",
		"tls", "certificado do rep",
	} {
		if strings.Contains(msg, marca) {
			return true
		}
	}
	return false
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

func HigienizarListagem(cfg *config.Config, d *config.DispositivoRepConfig) (ResultadoHigiene, error) {
	var resultado ResultadoHigiene
	if d == nil {
		return resultado, fmt.Errorf("nenhum relogio informado para higienizar")
	}
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

// ResultadoRemocao resume o que aconteceu num HigienizarRemocoes
type ResultadoRemocao struct {
	Pendentes int
	Removidos int
	Falhas    int
}

// HigienizarRemocoes aplica no relógio quem foi selecionado na tela de higiene (Fase 7b) para
// sair do equipamento. Agora automatizado no ciclo da bandeja com teto por lote (LimiteRemocoesPorCiclo).
//
// Só reporta sucesso ao SisEscala depois de RELISTAR o cadastro do relógio e confirmar que o
// usuário sumiu de verdade. O device já respondeu "ok" para chamada que não removeu nada, e
// marcar a fila como aplicada nesse caso deixaria o SisEscala achando que o relógio está limpo
// quando não está.
func HigienizarRemocoes(cfg *config.Config, d *config.DispositivoRepConfig, limite int) (ResultadoRemocao, error) {
	var resultado ResultadoRemocao
	if d == nil {
		return resultado, fmt.Errorf("nenhum relogio informado para remover")
	}
	sc := sisescala.NovoClient(cfg.SisEscala.URL, d.ID, d.Token)
	rc := rep.NovoClient(d.Endereco, d.Porta, d.UsaHTTPS, d.UsuarioRep, d.SenhaRep, d.CertFingerprint)

	pendentes, err := sc.ListarRemocoesPendentes()
	if err != nil {
		return resultado, fmt.Errorf("falha ao listar remocoes pendentes: %w", err)
	}
	resultado.Pendentes = len(pendentes)
	if len(pendentes) == 0 {
		return resultado, nil
	}

	if limite > 0 && len(pendentes) > limite {
		log.Printf("higiene: %d remocao(oes) pendente(s); aplicando %d neste ciclo, o resto no proximo",
			len(pendentes), limite)
		pendentes = pendentes[:limite]
	} else {
		log.Printf("higiene: %d remocao(oes) pendente(s) para aplicar no rele", len(pendentes))
	}

	// O corpo de remove_users.fcgi precisa de campos que só existem no snapshot do equipamento
	// (`code`/`registration`), não na fila do SisEscala — daí ler o cadastro antes de remover.
	usuarios, err := rc.ListarUsuarios()
	if err != nil {
		return resultado, fmt.Errorf("falha ao ler o cadastro do rele antes de remover: %w", err)
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
			resultado.Removidos++
			continue
		}

		if err := rc.RemoverUsuario(alvo); err != nil {
			resultado.Falhas++
			log.Printf("remocao de %s (%s) falhou: %v", p.NomeNoDevice, p.IdentificadorAFD, err)
			if erroConfirmar := sc.ConfirmarRemocao(p.FilaID, false, err.Error()); erroConfirmar != nil {
				log.Printf("aviso: falha tambem ao reportar erro da remocao %s: %v", p.FilaID, erroConfirmar)
			}
			// Erro de formato desconhecido vale para todo o lote: sem formato aceito, insistir nos
			// 30 seguintes só repete a mesma varredura de candidatos contra o equipamento.
			if rc.FormatoRemocaoUsado() == "" {
				return resultado, fmt.Errorf("nenhuma remocao foi aplicada: %w", err)
			}
			continue
		}
		tentados = append(tentados, p)
	}

	if len(tentados) == 0 {
		return resultado, nil
	}
	log.Printf("higiene: %d remocao(oes) aceitas pelo rele (formato %s) — conferindo por relistagem",
		len(tentados), rc.FormatoRemocaoUsado())

	depois, err := rc.ListarUsuarios()
	if err != nil {
		return resultado, fmt.Errorf("remocoes aplicadas, mas falha ao reler o cadastro do rele para confirmar "+
			"(nada foi confirmado no SisEscala; rodar de novo e' seguro): %w", err)
	}
	aindaNoDevice := make(map[string]bool, len(depois))
	for _, u := range depois {
		aindaNoDevice[u.IdentificadorAFD] = true
	}

	for _, p := range tentados {
		if aindaNoDevice[p.IdentificadorAFD] {
			resultado.Falhas++
			msg := "o rele aceitou a remocao mas o cadastro continua la (conferido por relistagem)"
			log.Printf("remocao de %s (%s): %s", p.NomeNoDevice, p.IdentificadorAFD, msg)
			if err := sc.ConfirmarRemocao(p.FilaID, false, msg); err != nil {
				log.Printf("aviso: falha ao reportar remocao nao efetivada %s: %v", p.FilaID, err)
			}
			continue
		}
		resultado.Removidos++
		log.Printf("usuario %s (%s) removido do rele", p.NomeNoDevice, p.IdentificadorAFD)
		if err := sc.ConfirmarRemocao(p.FilaID, true, ""); err != nil {
			log.Printf("aviso: usuario %s removido do rele mas falha ao confirmar no SisEscala: %v", p.FilaID, err)
		}
	}
	log.Printf("higiene: %d removido(s), %d nao efetivado(s) (pendentes no total: %d)",
		resultado.Removidos, resultado.Falhas, resultado.Pendentes)

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
	return resultado, nil
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
