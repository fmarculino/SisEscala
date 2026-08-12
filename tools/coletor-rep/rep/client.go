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
// nunca testadas contra hardware nenhum. Ver aviso extenso junto delas, mais abaixo neste
// arquivo, antes de habilitar em produção.
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

// ⚠️⚠️ NAO VALIDADO CONTRA HARDWARE REAL. CriarUsuario e ListarUsuariosComBiometria abaixo
// implementam a API generica "objects" da Control iD (create_objects.fcgi/load_objects.fcgi),
// que e o padrao documentado da linha iDClass/iDAccess para CRUD de usuarios/templates - mas
// nunca foi testada contra o device de 10.110.2.89 nem contra nenhum outro. login.fcgi e
// get_afd.fcgi so viraram confiaveis depois de bater com curl.exe -sk contra o hardware real
// (ver cabecalho do arquivo); o mesmo aconteceu com o formato de data do AFD, que parecia
// razoavel e estava errado (armadilha 11, CLAUDE.md). NÃO chame estas duas funcoes num ciclo
// automatico antes de confirmar com `coletor-rep cadastros-testar` (cmd/cli) que os nomes de
// campo abaixo (object "users": name/registration/pis; object "templates": user_id) batem com
// o que o equipamento realmente aceita e devolve.
//
// Os nomes 'registration' e 'pis' nao sao chute: ja foram confirmados como os campos reais do
// device por leitura de AFD tipo 5 real (ver comentario em rep_vinculos_servidor,
// supabase/migrations/20260808000000). O que nao foi confirmado e create_objects.fcgi aceitar
// GRAVACAO nesses mesmos campos, nem o formato exato da resposta (assumido {"ids":[...]}).

// CriarUsuario cadastra uma identidade "vazia" no rele (sem biometria - isso so acontece
// presencialmente no equipamento). Devolve o device_user_id atribuido pelo rele.
func (c *Client) CriarUsuario(matricula, nome, identificadorAfd string) (int64, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return 0, err
		}
	}

	resultado, err := c.chamar(fmt.Sprintf("create_objects.fcgi?session=%s", c.sessao), map[string]interface{}{
		"object": "users",
		"values": []map[string]interface{}{
			{"name": nome, "registration": matricula, "pis": identificadorAfd},
		},
	})
	if err != nil {
		return 0, err
	}

	ids, ok := resultado["ids"].([]interface{})
	if !ok || len(ids) == 0 {
		return 0, fmt.Errorf("create_objects.fcgi nao devolveu id de usuario: %v", resultado)
	}
	idFloat, ok := ids[0].(float64)
	if !ok {
		return 0, fmt.Errorf("id de usuario em formato inesperado: %v", ids[0])
	}
	return int64(idFloat), nil
}

// ListarUsuariosComBiometria devolve os device_user_id que tem pelo menos um template
// biometrico cadastrado no rele - usado para fechar o loop de "pendencias de biometria" sem
// exigir que ninguem digite nada no SisEscala manualmente.
func (c *Client) ListarUsuariosComBiometria() ([]int64, error) {
	if c.sessao == "" {
		if err := c.Login(); err != nil {
			return nil, err
		}
	}

	resultado, err := c.chamar(fmt.Sprintf("load_objects.fcgi?session=%s", c.sessao), map[string]interface{}{
		"object": "templates",
		"fields": []string{"user_id"},
	})
	if err != nil {
		return nil, err
	}

	templates, ok := resultado["templates"].([]interface{})
	if !ok {
		return nil, fmt.Errorf("load_objects.fcgi (templates) resposta inesperada: %v", resultado)
	}

	vistos := map[int64]bool{}
	var ids []int64
	for _, item := range templates {
		m, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		userID, ok := m["user_id"].(float64)
		if !ok {
			continue
		}
		if id := int64(userID); !vistos[id] {
			vistos[id] = true
			ids = append(ids, id)
		}
	}
	return ids, nil
}
