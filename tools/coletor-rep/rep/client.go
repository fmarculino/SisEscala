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
// ⚠️ CriarUsuario e ListarUsuariosComBiometria (Fase 7, 12/08/2026) são MAIS incertas ainda —
// a primeira tentativa (API genérica "objects") já foi testada contra hardware real e
// **rejeitada** (HTTP 400 "Invalid command" — API errada, pertencia a outra linha de produto
// Control iD). Reescrita em 12/08/2026 para `add_users.fcgi`/`load_users.fcgi`, a API real da
// linha iDClass — mas essa segunda versão ainda não foi confirmada contra hardware. Ver aviso
// extenso junto delas, mais abaixo neste arquivo, antes de habilitar em produção.
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
// supabase/migrations/20260808000000). O formato exato da resposta de add_users.fcgi (id do
// usuario criado) tambem nao foi confirmado — CriarUsuario tenta as formas mais prováveis
// (`ids`, `id`, `users[0].id`) e devolve o mapa cru em erro se nenhuma bater.

// CriarUsuario cadastra uma identidade "vazia" no rele (sem biometria - isso so acontece
// presencialmente no equipamento). Devolve o device_user_id atribuido pelo rele.
// identificadorAfd vem no formato de 12 digitos do AFD (CPF com zero de preenchimento); o campo
// cpf da API espera o CPF puro, daí o `right(...,11)` aqui — a mesma operacao inversa que
// fn_vinculos_sugeridos_afd já faz do lado do banco (armadilha 10, CLAUDE.md).
func (c *Client) CriarUsuario(matricula, nome, identificadorAfd string) (int64, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return 0, err
		}
	}

	cpf := identificadorAfd
	if len(cpf) > 11 {
		cpf = cpf[len(cpf)-11:]
	}

	resultado, err := c.chamar(fmt.Sprintf("add_users.fcgi?session=%s&mode=671", c.sessao), map[string]interface{}{
		"users": []map[string]interface{}{
			{"name": nome, "registration": matricula, "cpf": cpf, "admin": false},
		},
	})
	if err != nil {
		return 0, err
	}

	if id, ok := extrairIDCriado(resultado); ok {
		return id, nil
	}
	return 0, fmt.Errorf("add_users.fcgi nao devolveu id de usuario reconhecivel: %v", resultado)
}

// extrairIDCriado tenta os formatos de resposta mais prováveis de add_users.fcgi — nenhum
// confirmado ainda contra hardware real (ver aviso acima).
func extrairIDCriado(resultado map[string]interface{}) (int64, bool) {
	if ids, ok := resultado["ids"].([]interface{}); ok && len(ids) > 0 {
		if v, ok := ids[0].(float64); ok {
			return int64(v), true
		}
	}
	if id, ok := resultado["id"].(float64); ok {
		return int64(id), true
	}
	if users, ok := resultado["users"].([]interface{}); ok && len(users) > 0 {
		if m, ok := users[0].(map[string]interface{}); ok {
			if id, ok := m["id"].(float64); ok {
				return int64(id), true
			}
		}
	}
	return 0, false
}

// ListarUsuariosComBiometria devolve os device_user_id que tem pelo menos um template
// biometrico cadastrado no rele - usado para fechar o loop de "pendencias de biometria" sem
// exigir que ninguem digite nada no SisEscala manualmente. `templates: true` no pedido pede ao
// rele para incluir o array de templates biometricos na resposta (documentado: array vazio =
// sem biometria cadastrada).
func (c *Client) ListarUsuariosComBiometria() ([]int64, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return nil, err
		}
	}

	// Documentado: limit maximo 100 por chamada - "1000" de uma vez foi o que provavelmente
	// causou o HTTP 400 anterior (a mensagem de erro do rele nao nomeia o campo). Pagina ate a
	// pagina voltar com menos que o limite.
	const tamanhoPagina = 100
	var ids []int64
	var totalUsuarios int
	var semIDReconhecivel int
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
			userID, ok := m["id"].(float64)
			if !ok {
				semIDReconhecivel++
				continue
			}
			templates, ok := m["templates"].([]interface{})
			if ok && len(templates) > 0 {
				ids = append(ids, int64(userID))
			}
		}

		if len(usuarios) < tamanhoPagina {
			break
		}
	}

	// Campo "id" nao confirmado contra hardware real (a documentacao consultada nao mostrou
	// exemplo com ele) - se NENHUM usuario teve "id" reconhecivel apesar de existirem usuarios,
	// e mais provavel que o nome do campo esteja errado do que que o rele nao tenha ninguem
	// cadastrado. Falhar alto em vez de devolver lista vazia em silencio.
	if totalUsuarios > 0 && semIDReconhecivel == totalUsuarios {
		return nil, fmt.Errorf(
			"load_users.fcgi devolveu %d usuario(s) mas nenhum com campo 'id' reconhecivel - "+
				"o nome do campo de identificador pode ser outro. Exemplo cru de um usuario: %v",
			totalUsuarios, amostra)
	}
	return ids, nil
}
