// Quanto ponto esta preso em relogio cuja MAQUINA nao esta coletando.
// Le o last_nsr do proprio equipamento e compara com o banco. Sequencial e' deliberado: o
// handshake TLS custa ~1,1s de CPU DO EQUIPAMENTO e ele serializa (armadilha de 05/09/2026).
import { env } from './_env.mjs'
import { execFileSync } from 'child_process'
import fs from 'fs'
const E = env('.env.production')
const U = E.NEXT_PUBLIC_SUPABASE_URL, K = E.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const SENHA = fs.readFileSync('tools/coletor-rep/config.yaml', 'utf8').match(/senha_rep:\s*"?([^"\n\r]+)"?/)[1].trim()

const disp = await (await fetch(`${U}/rest/v1/dispositivos_rep?select=id,nome,endereco_ip,porta,ultimo_nsr,ultimo_contato_em,coletor_host,unidades(nome)&ativo=eq.true`, { headers: H })).json()
const parados = disp
  .map(d => ({ ...d, min: d.ultimo_contato_em ? (Date.now() - new Date(d.ultimo_contato_em)) / 60000 : Infinity }))
  .filter(d => d.min > 120 && d.endereco_ip)
  .sort((a, b) => b.min - a.min)

console.log(`relogios cuja maquina esta sem contato ha mais de 2h: ${parados.length}\n`)
const curl = (args) => execFileSync('curl.exe', args, { encoding: 'utf8', timeout: 40000 })
let totalPreso = 0, alcancados = 0, mudos = 0
for (const d of parados) {
  const base = `https://${d.endereco_ip}${d.porta && d.porta !== 443 ? ':' + d.porta : ''}`
  try {
    const s = JSON.parse(curl(['-sk', '--max-time', '25', '-X', 'POST', `${base}/login.fcgi`, '-H', 'Content-Type: application/json',
      '-d', JSON.stringify({ login: 'admin', password: SENHA })])).session
    const info = JSON.parse(curl(['-sk', '--max-time', '25', '-X', 'POST', `${base}/get_system_information.fcgi?session=${s}`,
      '-H', 'Content-Type: application/json', '-d', '{}']))
    const preso = Number(info.last_nsr || 0) - Number(d.ultimo_nsr || 0)
    totalPreso += Math.max(preso, 0); alcancados++
    console.log(`${d.nome.padEnd(30)} ${String(d.coletor_host).padEnd(16)} parada ha ${(d.min/60).toFixed(1)}h · relogio=${info.last_nsr} banco=${d.ultimo_nsr} · PRESAS=${preso}`)
  } catch (e) {
    mudos++
    console.log(`${d.nome.padEnd(30)} ${String(d.coletor_host).padEnd(16)} parada ha ${(d.min/60).toFixed(1)}h · equipamento NAO RESPONDE daqui`)
  }
}
console.log(`\nalcancados: ${alcancados} · mudos: ${mudos} · TOTAL DE BATIDAS PRESAS NOS ALCANCADOS: ${totalPreso}`)
