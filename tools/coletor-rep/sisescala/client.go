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
	"net/http"
	"strconv"
	"time"
)

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

func (c *Client) assinar(corpo []byte) (timestamp, assinatura string) {
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	somaCorpo := sha256.Sum256(corpo)

	mac := hmac.New(sha256.New, []byte(c.token))
	mac.Write([]byte(ts + hex.EncodeToString(somaCorpo[:])))
	return ts, hex.EncodeToString(mac.Sum(nil))
}

func (c *Client) chamar(metodo, caminho string, corpo []byte) ([]byte, int, error) {
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

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

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

// ConfirmarCadastro reporta o resultado de um item da fila — sucesso com o device_user_id
// atribuído pelo relógio, ou falha com o motivo. Idempotente: reenviar a confirmação de um
// item já processado não faz nada (fn_confirmar_cadastro_rep ignora silenciosamente).
func (c *Client) ConfirmarCadastro(filaID string, sucesso bool, deviceUserID *int64, mensagemErro string) error {
	payload := map[string]interface{}{"fila_id": filaID, "sucesso": sucesso}
	if deviceUserID != nil {
		payload["device_user_id"] = *deviceUserID
	}
	if mensagemErro != "" {
		payload["erro"] = mensagemErro
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

// ReportarBiometria envia os device_user_id que atualmente têm biometria cadastrada no
// relógio — só liga a flag do lado do SisEscala, nunca desliga (ver fn_atualizar_biometria_vinculos).
func (c *Client) ReportarBiometria(deviceUserIDs []int64) error {
	corpo, err := json.Marshal(map[string]interface{}{"device_user_ids": deviceUserIDs})
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
