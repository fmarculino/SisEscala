// Copia de biometria entre os relogios de uma mesma unidade (25/08/2026).
//
// O problema: numa unidade com 4 equipamentos, bater em qualquer entrada exige estar cadastrado
// COM DIGITAL nos 4 — e cadastrar digital e' presencial. Sem copia, sao 4 idas ao relogio por
// servidor. O caminho manual (pendrive, "Enviar/Receber usuarios") ja funciona e esta em
// docs/planos/2026-08-25-copia-de-biometria-entre-relogios.md; isto e a versao automatica.
//
// ⚠️ O TEMPLATE NUNCA VAI AO SERVIDOR. O SisEscala diz QUEM falta e em qual relogio da unidade
// buscar; a copia acontece equipamento -> equipamento, aqui dentro. Sao dois motivos, e os dois
// bastam sozinhos: dado biometrico e sensivel (LGPD), e o servidor nao tem rota de rede ate os
// relogios de qualquer forma.
//
// 🚨 NAO ENTRA NO CICLO AUTOMATICO enquanto o formato de escrita nao for confirmado em campo
// (rep.formatosTemplate: nenhum candidato validado contra hardware ate agora). Roda por clique no
// menu da bandeja ou por `coletor-rep-cli biometria-sincronizar`. Antes disso, rode
// `coletor-rep-cli biometria-testar`, que exercita o mesmo caminho contra o usuario descartavel.
package ciclo

import (
	"fmt"
	"log"

	"github.com/sms-maraba/sisescala-coletor-rep/config"
	"github.com/sms-maraba/sisescala-coletor-rep/rep"
	"github.com/sms-maraba/sisescala-coletor-rep/sisescala"
)

// LimiteBiometriaPorCiclo e' o teto de gravacoes por execucao automatica, para quando (e se) isto
// entrar no ciclo. O clique manual passa 0 (sem teto). Mesmo motivo do teto de cadastros: o ciclo
// e os cliques do menu dividem UMA goroutine, e escrever dezenas de templates seguidos deixaria a
// bandeja sem resposta.
const LimiteBiometriaPorCiclo = 10

// ResultadoBiometria resume uma execucao — usado pela bandeja para compor a notificacao.
type ResultadoBiometria struct {
	Pendentes int
	Copiados  int
	Falhas    int
	// SemOrigemLocal sao as pendencias cuja origem NAO esta no config.yaml desta maquina. Nao e
	// erro: e uma unidade em que os relogios estao divididos entre dois computadores. Contado a
	// parte para nao virar "falha" na tela de quem nao tem o que consertar.
	SemOrigemLocal int
}

// SincronizarBiometria copia, para o relogio `destino`, as digitais que faltam nele e existem em
// outro relogio da mesma unidade que ESTA MAQUINA tambem atende.
func SincronizarBiometria(cfg *config.Config, destino *config.DispositivoRepConfig, limite int) (ResultadoBiometria, error) {
	var resultado ResultadoBiometria
	if destino == nil {
		return resultado, fmt.Errorf("nenhum relogio informado como destino")
	}

	sc := sisescala.NovoClient(cfg.SisEscala.URL, destino.ID, destino.Token)
	pendencias, err := sc.ListarBiometriaFaltante()
	if err != nil {
		return resultado, fmt.Errorf("falha ao listar biometria faltante: %w", err)
	}
	resultado.Pendentes = len(pendencias)
	if len(pendencias) == 0 {
		return resultado, nil
	}

	if limite > 0 && len(pendencias) > limite {
		log.Printf("biometria: %d pendencia(s) em %s; aplicando %d nesta rodada",
			len(pendencias), destino.Rotulo(), limite)
		pendencias = pendencias[:limite]
	} else {
		log.Printf("biometria: %d pendencia(s) para copiar em %s", len(pendencias), destino.Rotulo())
	}

	rcDestino := rep.NovoClient(destino.Endereco, destino.Porta, destino.UsaHTTPS,
		destino.UsuarioRep, destino.SenhaRep, destino.CertFingerprint)

	// Uma listagem por equipamento, nao uma por pessoa: load_users.fcgi pagina de 100 em 100 e
	// carrega os templates junto. Repetir isso por servidor seria absurdo num relogio de 300.
	usuariosDestino, err := rcDestino.ListarUsuarios()
	if err != nil {
		return resultado, fmt.Errorf("falha ao ler o cadastro de %s: %w", destino.Rotulo(), err)
	}
	porIdentDestino := indexarPorIdentificador(usuariosDestino)

	// Cache das listagens de origem: varias pendencias costumam vir do mesmo relogio.
	origens := map[string]map[string]rep.UsuarioDispositivo{}

	for _, p := range pendencias {
		origemCfg := acharDispositivo(cfg, p.OrigemID)
		if origemCfg == nil {
			// Esta maquina nao atende o relogio de origem. Nao e' falha do equipamento nem da
			// pessoa: nao reporta ao SisEscala, senao a pendencia ficaria 24h bloqueada por um
			// impedimento que nao muda com o tempo — e a tela deixaria de mostrar o que falta.
			log.Printf("biometria: %s tem digital em %s, que nao esta no config.yaml desta maquina - pulando",
				p.ServidorNome, p.OrigemNome)
			resultado.SemOrigemLocal++
			continue
		}

		usuariosOrigem, ok := origens[p.OrigemID]
		if !ok {
			rcOrigem := rep.NovoClient(origemCfg.Endereco, origemCfg.Porta, origemCfg.UsaHTTPS,
				origemCfg.UsuarioRep, origemCfg.SenhaRep, origemCfg.CertFingerprint)
			lista, err := rcOrigem.ListarUsuarios()
			if err != nil {
				log.Printf("biometria: falha ao ler o cadastro de %s (origem): %v", origemCfg.Rotulo(), err)
				// Origem fora do ar e' transitorio: nao reporta, tenta na proxima.
				resultado.Falhas++
				continue
			}
			usuariosOrigem = indexarPorIdentificador(lista)
			origens[p.OrigemID] = usuariosOrigem
		}

		naOrigem, existe := usuariosOrigem[p.OrigemIdentificadorAfd]
		if !existe || len(naOrigem.Templates) == 0 {
			// O SisEscala achava que havia digital ali e nao ha (o snapshot dele e' de ate 5 min
			// atras, ou alguem apagou o cadastro no equipamento). Reportar como falha e' certo:
			// e' informacao que a tela precisa, e evita reencostar nisso a cada rodada.
			registrar(sc, p, false, 0, "", fmt.Sprintf(
				"o relogio de origem (%s) nao tem digital cadastrada para %s", p.OrigemNome, p.OrigemIdentificadorAfd))
			resultado.Falhas++
			continue
		}

		alvo, existe := porIdentDestino[p.DestinoIdentificadorAfd]
		if !existe {
			registrar(sc, p, false, 0, "", fmt.Sprintf(
				"%s nao esta cadastrado em %s - a identidade precisa chegar antes (Sincronizar cadastros)",
				p.ServidorNome, destino.Rotulo()))
			resultado.Falhas++
			continue
		}
		if alvo.TemBiometria {
			// Ja tem digital: nada a fazer, e reportar sucesso mantem a tela em dia sem escrever
			// no equipamento.
			registrar(sc, p, true, 0, "", "")
			continue
		}

		formato, err := rcDestino.GravarTemplates(alvo, naOrigem.Templates)
		if err != nil {
			if ehFalhaDeTransporte(err) {
				// Rede/timeout: nao queima a pendencia por causa de um blecaute de um minuto -
				// mesma distincao que SincronizarCadastros ja faz com `transitorio`.
				log.Printf("biometria: falha de transporte em %s, tentando na proxima: %v", p.ServidorNome, err)
				resultado.Falhas++
				continue
			}
			log.Printf("biometria: %s recusado por %s: %v", p.ServidorNome, destino.Rotulo(), err)
			registrar(sc, p, false, 0, "", err.Error())
			resultado.Falhas++
			continue
		}

		log.Printf("biometria: %s copiada de %s para %s (%d template(s), formato %s)",
			p.ServidorNome, p.OrigemNome, destino.Rotulo(), len(naOrigem.Templates), formato)
		registrar(sc, p, true, len(naOrigem.Templates), formato, "")
		resultado.Copiados++
	}

	return resultado, nil
}

// SincronizarBiometriaTodos roda a copia em cada relogio desta maquina como DESTINO. Numa unidade
// de dois equipamentos, isso cobre os dois sentidos: quem tem digital so no relogio 1 recebe no 2,
// e vice-versa.
func SincronizarBiometriaTodos(cfg *config.Config, limite int) (ResultadoBiometria, error) {
	var total ResultadoBiometria
	err := paraCada(cfg, "biometria", func(d *config.DispositivoRepConfig) error {
		r, err := SincronizarBiometria(cfg, d, limite)
		total.Pendentes += r.Pendentes
		total.Copiados += r.Copiados
		total.Falhas += r.Falhas
		total.SemOrigemLocal += r.SemOrigemLocal
		return err
	})
	return total, err
}

func registrar(sc *sisescala.Client, p sisescala.BiometriaFaltante, sucesso bool, templates int, formato, erro string) {
	if err := sc.RegistrarCopiaBiometria(p.ServidorID, p.OrigemID, sucesso, templates, erro, formato, Hostname()); err != nil {
		log.Printf("aviso: copia de biometria de %s nao pode ser reportada ao SisEscala: %v", p.ServidorNome, err)
	}
}

func indexarPorIdentificador(usuarios []rep.UsuarioDispositivo) map[string]rep.UsuarioDispositivo {
	indice := make(map[string]rep.UsuarioDispositivo, len(usuarios))
	for _, u := range usuarios {
		// Com dois cadastros do mesmo identificador (nao deveria existir - o device tem indice
		// unico), fica o que TEM digital: e' o util para copiar.
		if ja, existe := indice[u.IdentificadorAFD]; existe && ja.TemBiometria && !u.TemBiometria {
			continue
		}
		indice[u.IdentificadorAFD] = u
	}
	return indice
}

func acharDispositivo(cfg *config.Config, id string) *config.DispositivoRepConfig {
	for _, d := range cfg.Dispositivos() {
		if d.ID == id {
			return d
		}
	}
	return nil
}
