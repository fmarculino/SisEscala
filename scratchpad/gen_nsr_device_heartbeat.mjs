// Coletor v0.19.0: o heartbeat passa a reportar o last_nsr do EQUIPAMENTO.
// Detecta o EOL de cada arquivo e ABORTA se qualquer trecho nao bater exatamente 1 vez.
import fs from 'fs'

const arquivos = new Map()
function abrir(p) {
  if (!arquivos.has(p)) {
    const s = fs.readFileSync(p, 'utf8')
    arquivos.set(p, { s, N: s.includes('\r\n') ? '\r\n' : '\n' })
  }
  return arquivos.get(p)
}
function sub(p, de, para) {
  const a = abrir(p)
  const d = de.replace(/\n/g, a.N), q = para.replace(/\n/g, a.N)
  const n = a.s.split(d).length - 1
  if (n !== 1) throw new Error(`${p}: esperava 1 ocorrencia, achei ${n} -> ${d.slice(0, 70)}`)
  a.s = a.s.replace(d, q)
}

const CICLO = 'tools/coletor-rep/ciclo/ciclo.go'
const CLIENT = 'tools/coletor-rep/sisescala/client.go'
const CLI = 'tools/coletor-rep/cmd/cli/main.go'

// ---------------------------------------------------------------- versao
sub(CICLO, 'const Versao = "0.18.0"', 'const Versao = "0.19.0"')

// ---------------------------------------------------------------- ResultadoHeartbeat
sub(CICLO,
`	// RelogioAjustado diz se este ciclo acertou a hora do equipamento.
	RelogioAjustado bool
}`,
`	// RelogioAjustado diz se este ciclo acertou a hora do equipamento.
	RelogioAjustado bool

	// UltimoNsrDevice e o maior NSR que o EQUIPAMENTO declara ter (get_system_information.
	// last_nsr). Nil = nao foi possivel ler; NAO e zero, e a diferenca importa: o servidor
	// precisa distinguir "nao sei" de "esta em dia", senao um relogio sem leitura nenhuma
	// aparece como perfeito. Ver 20260919110000.
	UltimoNsrDevice *int64
}

// lerUltimoNsrDevice le o last_nsr do equipamento. Nunca derruba o heartbeat: nao saber o NSR do
// device e' pior que saber, mas e' MUITO melhor que perder tambem a versao, o host e a deriva.
//
// 🚨 Esta leitura ja existia e estava ORFA: rep.InformacoesSistema() nao tinha um unico chamador
// no coletor. Era ela que faltava para o SisEscala saber, sem nenhuma rota ate a rede da unidade,
// quanto ponto esta registrado no relogio e ainda nao chegou -- o sinal que teria detectado o
// REP-iDClass-HMI-01 no primeiro ciclo em vez de em 38 horas (18/09/2026).
func lerUltimoNsrDevice(rc *rep.Client) *int64 {
	info, err := rc.InformacoesSistema()
	if err != nil {
		log.Printf("aviso: nao foi possivel ler o last_nsr do equipamento: %v", err)
		return nil
	}
	return extrairUltimoNsr(info)
}

// extrairUltimoNsr e a parte PURA, separada so para ter portao: e aqui que mora a regra de que
// ausencia nunca vira zero, e ela nao pode ser testada atraves de um *rep.Client.
func extrairUltimoNsr(info map[string]interface{}) *int64 {
	bruto, ok := info["last_nsr"]
	if !ok {
		return nil
	}
	// O device devolve numero JSON, que o encoding/json entrega como float64. Firmware que
	// mandasse string tambem entra: o que nao pode e' virar 0 em silencio.
	switch v := bruto.(type) {
	case float64:
		n := int64(v)
		if n <= 0 {
			return nil
		}
		return &n
	case string:
		n, err := strconv.ParseInt(strings.TrimSpace(v), 10, 64)
		if err != nil || n <= 0 {
			return nil
		}
		return &n
	}
	return nil
}`)

// ---------------------------------------------------------------- uso no heartbeat
sub(CICLO,
`		estado.ErroRelogio = err
		return estado, sc.Heartbeat(nil, Versao, Hostname(), IPLocal(d.Endereco))`,
`		estado.ErroRelogio = err
		// Sem hora nao quer dizer sem NSR: sao chamadas diferentes, e o relogio pode responder
		// uma e nao a outra. Tentar aqui tambem e' o que mantem o sinal vivo num equipamento
		// cujo get_system_date_time falha.
		estado.UltimoNsrDevice = lerUltimoNsrDevice(rc)
		return estado, sc.Heartbeat(nil, Versao, Hostname(), IPLocal(d.Endereco), estado.UltimoNsrDevice)`)

sub(CICLO,
`	sincronizarRelogioDispositivo(rc, d, &estado)

	return estado, sc.Heartbeat(&relogioDevice, Versao, Hostname(), IPLocal(d.Endereco))`,
`	sincronizarRelogioDispositivo(rc, d, &estado)

	// Depois do ajuste de hora, e no MESMO rep.Client: o handshake TLS custa ~1,1s de CPU do
	// equipamento e ele serializa os handshakes, entao reusar a conexao ja aberta e' ~50x mais
	// barato que abrir outra so para esta leitura.
	estado.UltimoNsrDevice = lerUltimoNsrDevice(rc)

	return estado, sc.Heartbeat(&relogioDevice, Versao, Hostname(), IPLocal(d.Endereco), estado.UltimoNsrDevice)`)

// ---------------------------------------------------------------- cliente HTTP
sub(CLIENT,
`func (c *Client) Heartbeat(relogioDevice *time.Time, coletorVersao, coletorHost, coletorIP string) error {
	payload := map[string]interface{}{}`,
`func (c *Client) Heartbeat(relogioDevice *time.Time, coletorVersao, coletorHost, coletorIP string, ultimoNsrDevice *int64) error {
	payload := map[string]interface{}{}
	// ⚠️ Ausente e' diferente de zero, e o servidor conta com isso: campo nao enviado deixa
	// dispositivos_rep.nsr_device como esta (NULL num coletor que nunca reportou), em vez de
	// afirmar que o equipamento nao tem batida nenhuma. Ver 20260919110000.
	if ultimoNsrDevice != nil && *ultimoNsrDevice > 0 {
		payload["ultimo_nsr_device"] = *ultimoNsrDevice
	}`)

// ---------------------------------------------------------------- CLI
sub(CLI,
`		if err := sc.Heartbeat(nil, ciclo.Versao, ciclo.Hostname(), ciclo.IPLocal(d.Endereco)); err != nil {`,
`		if err := sc.Heartbeat(nil, ciclo.Versao, ciclo.Hostname(), ciclo.IPLocal(d.Endereco), nil); err != nil {`)

for (const [p, a] of arquivos) {
  fs.writeFileSync(p, a.s)
  console.log(`  ${p} (${a.N === '\r\n' ? 'CRLF' : 'LF'})`)
}

// ---------------------------------------------------------------- invariantes
const ciclo = fs.readFileSync(CICLO, 'utf8')
const client = fs.readFileSync(CLIENT, 'utf8')
const exigir = (txt, re, n, rot) => {
  const c = (txt.match(re) || []).length
  if (c !== n) throw new Error(`invariante "${rot}": esperava ${n}, achei ${c}`)
  console.log(`  invariante OK: ${rot} (${c})`)
}
exigir(ciclo, /const Versao = "0\.19\.0"/g, 1, 'versao bumpada')
exigir(ciclo, /lerUltimoNsrDevice\(/g, 3, 'lerUltimoNsrDevice: 1 def + 2 usos (com e sem hora)')
// `rc.` na frente: o comentario do helper CITA o nome da funcao, e contar o nome cru daria 2.
exigir(ciclo, /rc\.InformacoesSistema\(\)/g, 1, 'a leitura orfa passou a ter chamador')
exigir(client, /ultimo_nsr_device/g, 1, 'campo enviado ao servidor')
exigir(client, /ultimoNsrDevice != nil && \*ultimoNsrDevice > 0/g, 1, 'ausente nunca vira zero')
