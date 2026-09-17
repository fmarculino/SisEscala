/**
 * Portao da preferencia de layout da grade de escala (cabecalho dos dias travado).
 *
 * Transpile antes:
 *   npx tsc src/utils/escala/preferenciaGrade.ts --outDir scratchpad/_sim --module commonjs --target es2020
 *
 * Rode:  node scratchpad/sim_cabecalho_fixo.js
 */
const path = require('path')
const mod = require(path.join(__dirname, '_sim', 'preferenciaGrade.js'))
const {
  alturaDisponivelParaGrade, lerPreferenciaCabecalhoFixo, gravarPreferenciaCabecalhoFixo,
  CABECALHO_FIXO_PADRAO, CHAVE_CABECALHO_FIXO, ALTURA_MINIMA_GRADE, FOLGA_INFERIOR_GRADE,
} = mod

let falhas = 0, total = 0
function ok(cond, nome) {
  total++
  if (!cond) { falhas++; console.error(`  REPROVADO: ${nome}`) }
}
function comStorage(storage, fn) {
  const antes = global.window
  global.window = { localStorage: storage }
  try { return fn() } finally { if (antes === undefined) delete global.window; else global.window = antes }
}
function storageFalso(inicial) {
  const dados = { ...(inicial || {}) }
  return {
    dados,
    getItem: (k) => (k in dados ? dados[k] : null),
    setItem: (k, v) => { dados[k] = String(v) },
  }
}
const storageQueLanca = {
  getItem: () => { throw new Error('site data bloqueado') },
  setItem: () => { throw new Error('quota exceeded') },
}

// ── Padrao ────────────────────────────────────────────────────────────────────────────
// Foi o que os usuarios pediram: quem nunca clicou abre a grade com o cabecalho travado.
ok(CABECALHO_FIXO_PADRAO === true, 'o padrao e travado')
ok(comStorage(storageFalso(), lerPreferenciaCabecalhoFixo) === true, 'sem nada salvo, devolve o padrao')

// ── Leitura ───────────────────────────────────────────────────────────────────────────
ok(comStorage(storageFalso({ [CHAVE_CABECALHO_FIXO]: '0' }), lerPreferenciaCabecalhoFixo) === false,
  'quem desligou continua desligado')
ok(comStorage(storageFalso({ [CHAVE_CABECALHO_FIXO]: '1' }), lerPreferenciaCabecalhoFixo) === true,
  'quem ligou continua ligado')
ok(comStorage(storageFalso({ [CHAVE_CABECALHO_FIXO]: 'lixo' }), lerPreferenciaCabecalhoFixo) === false,
  'valor corrompido nao vira o padrao por acidente: so "1" liga')

// ── Falha de storage nao pode derrubar a grade ────────────────────────────────────────
let lancou = false
try { ok(comStorage(storageQueLanca, lerPreferenciaCabecalhoFixo) === CABECALHO_FIXO_PADRAO,
  'storage que lanca na leitura cai para o padrao') } catch { lancou = true }
ok(!lancou, 'ler preferencia nunca propaga excecao (janela anonima, site data bloqueado)')

lancou = false
try { comStorage(storageQueLanca, () => gravarPreferenciaCabecalhoFixo(true)) } catch { lancou = true }
ok(!lancou, 'gravar preferencia nunca propaga excecao (storage cheio)')

lancou = false
try { ok(lerPreferenciaCabecalhoFixo() === CABECALHO_FIXO_PADRAO, 'sem window (SSR) devolve o padrao') }
catch { lancou = true }
ok(!lancou, 'sem window (SSR) nao lanca')

// ── Gravacao ──────────────────────────────────────────────────────────────────────────
const s1 = storageFalso()
comStorage(s1, () => gravarPreferenciaCabecalhoFixo(false))
ok(s1.dados[CHAVE_CABECALHO_FIXO] === '0', 'desligar grava 0')
comStorage(s1, () => gravarPreferenciaCabecalhoFixo(true))
ok(s1.dados[CHAVE_CABECALHO_FIXO] === '1', 'ligar grava 1')
ok(comStorage(s1, lerPreferenciaCabecalhoFixo) === true, 'o que foi gravado e o que volta na leitura')

// ── Altura disponivel ─────────────────────────────────────────────────────────────────
ok(alturaDisponivelParaGrade(200, 900) === 900 - 200 - FOLGA_INFERIOR_GRADE,
  'altura = area visivel - distancia do topo - folga')
ok(alturaDisponivelParaGrade(300, 1080) > alturaDisponivelParaGrade(500, 1080),
  'card que comeca mais abaixo (tarja de escala inativa, aviso de versao) recebe menos altura')
ok(alturaDisponivelParaGrade(200, 1200) > alturaDisponivelParaGrade(200, 800),
  'monitor maior rende mais grade')

// ⚠️ Piso: em monitor baixo a conta pode dar um valor em que nao cabe linha nenhuma. Ali vale
// mais deixar a PAGINA rolar um pouco do que espremer a grade a nada.
ok(alturaDisponivelParaGrade(350, 400) === ALTURA_MINIMA_GRADE, 'monitor baixo cai no piso')
ok(alturaDisponivelParaGrade(900, 600) === ALTURA_MINIMA_GRADE, 'distancia maior que a tela cai no piso')
ok(alturaDisponivelParaGrade(0, 0) === ALTURA_MINIMA_GRADE, 'area ainda sem medida cai no piso')
ok(alturaDisponivelParaGrade(NaN, 900) === ALTURA_MINIMA_GRADE, 'medida invalida cai no piso, nunca NaN')
ok(alturaDisponivelParaGrade(Infinity, 900) === ALTURA_MINIMA_GRADE, 'medida infinita cai no piso')
ok(Number.isInteger(alturaDisponivelParaGrade(200.4, 900.7)), 'a altura sai inteira (vira pixel)')
ok(alturaDisponivelParaGrade(200, 900, 0) === 700, 'a folga inferior e parametrizavel')
ok(alturaDisponivelParaGrade(100, 900, 24, 800) === 800, 'o piso e parametrizavel')

// A folga existe para a borda de baixo do card nao encostar no fim da area visivel.
ok(FOLGA_INFERIOR_GRADE > 0, 'existe folga abaixo do card')
ok(alturaDisponivelParaGrade(200, 900) < 900 - 200, 'a altura nunca ocupa a area visivel inteira')

console.log(falhas === 0
  ? `OK: ${total} assercoes`
  : `FALHOU: ${falhas} de ${total} assercoes`)
process.exit(falhas === 0 ? 0 : 1)
