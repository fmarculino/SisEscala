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

type Client struct {
	baseURL    string
	httpClient *http.Client
	usuario    string
	senha      string
	sessao     string

	// formatoRemocao guarda qual corpo de remove_users.fcgi este equipamento aceitou nesta
	// execucao - descoberto na primeira remocao (ver descobrirFormatoRemocao) e reusado depois,
	// para nao repetir a varredura de candidatos a cada usuario do lote.
	formatoRemocao *formatoRemocao
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
