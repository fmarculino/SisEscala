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
// ⚠️ CriarUsuario e ListarUsuariosComBiometria (Fase 7, 12/08/2026) — três rodadas de teste
// real até aqui: (1) API genérica "objects" rejeitada, API errada (outra linha de produto
// Control iD); (2) `add_users.fcgi`/`load_users.fcgi` reconhecidos, mas CPF de teste inválido e
// `limit` acima do máximo; (3) `load_users.fcgi` confirmou dados reais (6 usuários do piloto) —
// e revelou que este device **não tem campo "id"** e que `pis`/`registration` são NÚMEROS, não
// strings. `device_user_id` deixou de ser o identificador de referência — passou a ser `pis`
// (mesmo formato de `identificador_afd`). CriarUsuario ainda não confirmou sucesso end-to-end.
// Ver aviso extenso junto das duas funções, mais abaixo neste arquivo.
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

type Client struct {
	baseURL    string
	httpClient *http.Client
	usuario    string
	senha      string
	sessao     string
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

	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout:   30 * time.Second,
			Transport: &http.Transport{TLSClientConfig: tlsConfig},
		},
		usuario: usuario,
		senha:   senha,
	}
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

// GetAFD busca os registros de AFD a partir de initialNsr (inclusive) — sempre incremental,
// nunca o arquivo inteiro do zero em produção (ver comentário em rodarSync sobre isso).
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

	resp, err := c.httpClient.Do(req)
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

// ⚠️⚠️ AJUSTADO EM 12/08/2026 APOS O PRIMEIRO TESTE REAL FALHAR — AINDA NAO CONFIRMADO DE VOLTA.
// A primeira tentativa usava a API generica "objects" (create_objects.fcgi/load_objects.fcgi) —
// o rele de teste (10.110.2.89) recusou as duas com HTTP 400 "Invalid command", confirmando que
// esse padrao pertence a OUTRA linha de produto da Control iD (Linha de Acesso — iDAccess/
// iDFlex/iDBlock), nao a linha REP/iDClass que login.fcgi/get_afd.fcgi ja confirmaram real
// aqui. A API certa da linha iDClass usa comandos por entidade: `add_users.fcgi` para criar,
// `load_users.fcgi` para listar (confirmado por busca na documentacao oficial da Control iD,
// controlid.com.br/suporte/api_idclass_latest.html — ainda NAO testado contra hardware).
// `get_afd.fcgi` ja e chamado com `mode=671` neste codigo (Portaria 671/2021) — por isso
// add_users.fcgi tambem usa `mode=671` e o campo `cpf` (a documentacao diz que sem mode=671 o
// campo seria `pis`). Rode `coletor-rep-cli cadastros-testar` de novo contra o rele de teste
// antes de confiar nisso em producao — se a resposta ainda nao bater, ela aparece crua no erro.
//
// O campo 'registration' (matricula) nao e chute: ja foi confirmado como o campo real do device
// por leitura de AFD tipo 5 real (ver comentario em rep_vinculos_servidor,
// supabase/migrations/20260808000000).
//
// ⚠️ CONFIRMADO EM 12/08/2026 via load_users.fcgi real (6 usuarios do piloto, devolvidos com
// sucesso): o objeto "user" deste device **nao tem campo "id"** — so `pis`/`registration`/`code`
// /`rfid`/`templates`/etc, TODOS como numero JSON, nao string. `add_users.fcgi` recusou o
// primeiro teste com "'cpf' em formato incorreto" ao receber `"cpf": "11144477735"` (string) —
// e a evidencia do load_users real (`pis` sempre numero) aponta pra causa provavel: o campo tem
// que ser numero, nao string. Corrigido abaixo. Como o device nao expoe um id interno separado,
// a identidade de referencia passa a ser sempre `pis`/`registration`, nao um `device_user_id`
// sintetico — ListarUsuariosComBiometria casa por `pis`, nao por id.
//
// ⚠️ `registration` e' numero no device (visto real: `2.600005e+06` = matricula 2600005) —
// matricula temporaria alfanumerica (formato `T26xxxxx`, ver CLAUDE.md) tem o "T" removido
// antes de virar numero, replicando a convencao que ja estava em uso manualmente neste mesmo
// rele (confirmado pelo usuario, nao documentado em lugar nenhum do codigo). CriarUsuario ainda
// recusa cedo se sobrar algo nao-numerico depois de tirar o prefixo.

// CriarUsuario cadastra uma identidade "vazia" no rele (sem biometria - isso so acontece
// presencialmente no equipamento). identificadorAfd vem no formato de 12 digitos do AFD (CPF
// com zero de preenchimento); o campo cpf da API espera o CPF puro como NUMERO, daí o
// `right(...,11)` + conversao — a mesma operacao inversa que fn_vinculos_sugeridos_afd já faz
// do lado do banco (armadilha 10, CLAUDE.md).
func (c *Client) CriarUsuario(matricula, nome, identificadorAfd string) error {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return err
		}
	}

	// Matricula temporaria (formato TYYNNNNN, CLAUDE.md) tem o "T" removido antes de virar
	// numero - NAO documentado em lugar nenhum do codigo/planos, confirmado pelo usuario
	// (12/08/2026) como o que ja foi feito na mao para os servidores ja cadastrados neste
	// mesmo rele. Replica a convencao ja em uso, nao inventa uma nova.
	matriculaLimpa := strings.TrimPrefix(strings.ToUpper(matricula), "T")
	matriculaNum, err := strconv.ParseInt(matriculaLimpa, 10, 64)
	if err != nil {
		return fmt.Errorf("matricula %q (sem prefixo: %q) nao e numerica - este rele so aceita "+
			"'registration' numerico: %w", matricula, matriculaLimpa, err)
	}

	cpfStr := identificadorAfd
	if len(cpfStr) > 11 {
		cpfStr = cpfStr[len(cpfStr)-11:]
	}
	cpfNum, err := strconv.ParseInt(cpfStr, 10, 64)
	if err != nil {
		return fmt.Errorf("identificador_afd %q nao produziu um cpf numerico valido: %w", identificadorAfd, err)
	}

	resultado, err := c.chamar(fmt.Sprintf("add_users.fcgi?session=%s&mode=671", c.sessao), map[string]interface{}{
		"users": []map[string]interface{}{
			{"name": nome, "registration": matriculaNum, "cpf": cpfNum, "admin": false},
		},
	})
	if err != nil {
		return err
	}

	if errMsg, ok := resultado["error"]; ok {
		return fmt.Errorf("add_users.fcgi recusou: %v", errMsg)
	}
	return nil
}

// ListarUsuariosComBiometria devolve os identificador_afd (formato de 12 digitos, mesma
// convencao de rep_vinculos_servidor) dos usuarios que tem pelo menos um template biometrico
// cadastrado no rele - usado para fechar o loop de "pendencias de biometria" sem exigir que
// ninguem digite nada no SisEscala manualmente. `templates: true` no pedido pede ao rele para
// incluir o array de templates biometricos na resposta (confirmado: array vazio = sem
// biometria). Casa por `pis`, nao por um "id" que este device nao tem (ver aviso acima).
func (c *Client) ListarUsuariosComBiometria() ([]string, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return nil, err
		}
	}

	// Documentado: limit maximo 100 por chamada - "1000" de uma vez foi o que provavelmente
	// causou o HTTP 400 anterior (a mensagem de erro do rele nao nomeia o campo). Pagina ate a
	// pagina voltar com menos que o limite.
	const tamanhoPagina = 100
	var identificadores []string
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

		usuarios, ok := resultado["users"].([]interface{})
		if !ok {
			return nil, fmt.Errorf("load_users.fcgi resposta inesperada: %v", resultado)
		}

		for _, item := range usuarios {
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
			templates, ok := m["templates"].([]interface{})
			if ok && len(templates) > 0 {
				identificadores = append(identificadores, fmt.Sprintf("%012d", int64(pis)))
			}
		}

		if len(usuarios) < tamanhoPagina {
			break
		}
	}

	if totalUsuarios > 0 && semPisReconhecivel == totalUsuarios {
		return nil, fmt.Errorf(
			"load_users.fcgi devolveu %d usuario(s) mas nenhum com campo 'pis' reconhecivel - "+
				"o nome do campo de identificador pode ser outro (modo 671 usa 'cpf'?). Exemplo cru: %v",
			totalUsuarios, amostra)
	}
	return identificadores, nil
}
