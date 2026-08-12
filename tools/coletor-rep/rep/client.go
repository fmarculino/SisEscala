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
// paginação já confirmada, então herda a confiança dela. RemoverUsuario (mesma leva) é
// diferente: remove_users.fcgi NUNCA foi chamado contra o device real, o corpo da chamada é uma
// aproximação por simetria com load_users.fcgi. Não habilitar no ciclo automático nem no menu da
// bandeja até validar contra um usuário de teste (ver aviso na própria função).
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

// UsuarioDispositivo é um usuário como veio de load_users.fcgi, sem filtro de biometria - base
// da higiene de cadastros (Fase 7b, 12/08/2026): o rele chega usado por outro sistema antes do
// SisEscala, com usuarios que podem nao fazer mais parte do quadro. RegistrationBruto fica como
// veio do device (string, mesmo sendo numero na API) porque aqui e' so' para exibicao/auditoria -
// nunca vira identidade de referencia (essa continua sendo IdentificadorAFD, ver armadilha 10).
type UsuarioDispositivo struct {
	IdentificadorAFD  string
	RegistrationBruto string
	Nome              string
	TemBiometria      bool
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
			if reg, ok := m["registration"].(float64); ok {
				registrationBruto = strconv.FormatInt(int64(reg), 10)
			}
			nome, _ := m["name"].(string)
			templates, _ := m["templates"].([]interface{})

			usuarios = append(usuarios, UsuarioDispositivo{
				IdentificadorAFD:  fmt.Sprintf("%012d", int64(pis)),
				RegistrationBruto: registrationBruto,
				Nome:              nome,
				TemBiometria:      len(templates) > 0,
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

// RemoverUsuario tira um usuario do rele (remove_users.fcgi) - identifica por `pis`, o mesmo
// campo que load_users.fcgi/ListarUsuarios devolvem como identidade (armadilha 10:
// identificador_afd = pis, 12 digitos, CPF com zero de preenchimento).
//
// ⚠️ NUNCA CONFIRMADO CONTRA HARDWARE REAL. Ao contrario de add_users.fcgi/load_users.fcgi
// (cinco rodadas de teste em 12/08/2026, ver aviso no topo do arquivo), remove_users.fcgi nunca
// foi chamado contra o device de verdade. O corpo abaixo segue por simetria o mesmo formato de
// load_users.fcgi (array "users" com o campo que identifica cada um) - e' a melhor aproximacao,
// nao uma confirmacao. Antes de confiar nisto em cima de um cadastro real, valide contra um
// usuario de teste (o "SISESCALA TESTE - PODE APAGAR" que `cadastros-testar` cria e' o alvo
// natural) e so' depois rode `coletor-rep higiene-remover` de verdade.
func (c *Client) RemoverUsuario(identificadorAfd string) error {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return err
		}
	}

	pisNum, err := strconv.ParseInt(identificadorAfd, 10, 64)
	if err != nil {
		return fmt.Errorf("identificador_afd %q nao e numerico: %w", identificadorAfd, err)
	}

	resultado, err := c.chamar(fmt.Sprintf("remove_users.fcgi?session=%s&mode=671", c.sessao), map[string]interface{}{
		"users": []map[string]interface{}{{"pis": pisNum}},
	})
	if err != nil {
		return err
	}

	if errMsg, ok := resultado["error"]; ok {
		return fmt.Errorf("remove_users.fcgi recusou: %v", errMsg)
	}
	return nil
}
