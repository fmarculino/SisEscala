// Item 10 da auditoria: as RPCs que consomem fila do REP passam a conferir que o `fila_id`
// pertence ao DISPOSITIVO autenticado.
//
// ⚠️ COPIA MECANICA (armadilha 1 do CLAUDE.md): as duas funcoes sao regeneradas a partir do
// arquivo VIGENTE, com substituicoes pontuais e contagem. Nada e redigitado a mao.
//
// ⚠️ O PARAMETRO NOVO TEM `DEFAULT NULL`, E ISSO E DELIBERADO — nao e descuido.
//   Sem default, a assinatura muda e cria uma janela em que a ordem migration/deploy quebra
//   nos DOIS sentidos. E medido que essa janela custa caro: quando a confirmacao de cadastro
//   falha, o usuario JA FOI CRIADO no relogio (ciclo.go:415 so registra um aviso), o item fica
//   `pendente`, e no ciclo seguinte o coletor tenta criar de novo -> o equipamento recusa por
//   duplicidade -> `fn_confirmar_cadastro_rep` trata recusa como DEFINITIVA e o item vira
//   'falhou', exigindo reenfileiramento manual.
//
//   Com `DEFAULT NULL`: chamador antigo (sem o parametro) continua funcionando; chamador novo
//   passa o dispositivo e a divergencia e RECUSADA. Zero risco de ordem, nos dois sentidos.
//
//   O preco e que a checagem so vale se quem chama passar o parametro — por isso existe o
//   portao `scratchpad/sim_rep_fila_dono.js`, que reprova rota de /api/rep/v1/ que consuma fila
//   sem repassar o dispositivo autenticado.
const fs = require('fs')
const path = require('path')

function exigir(c, m) { if (!c) { console.error('ABORTADO: ' + m); process.exit(1) } }

const DIR = 'supabase/migrations'
function vigente(fn) {
  const arqs = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
    .filter(f => fs.readFileSync(path.join(DIR, f), 'utf8').includes(`FUNCTION public.${fn}`))
  exigir(arqs.length > 0, `nenhuma migration define ${fn}`)
  return path.join(DIR, arqs[arqs.length - 1])
}

// ⚠️ As migrations sao CRLF (convencao do projeto) e os literais deste script sao LF. Casar sem
// normalizar devolve ZERO ocorrencia e o script aborta sem dizer o motivo real — foi o que
// aconteceu na primeira execucao. Todo padrao passa por aqui antes de ser comparado.
function comEol(texto, eol) { return texto.replace(/\r?\n/g, eol) }

/** Extrai o bloco `CREATE OR REPLACE FUNCTION <fn> ... $fn$;` inteiro, verbatim. */
function extrair(arquivo, fn) {
  const src = fs.readFileSync(arquivo, 'utf8')
  const ini = src.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`)
  exigir(ini >= 0, `${fn} nao encontrada em ${arquivo}`)
  // o corpo e delimitado por $fn$ ... $fn$; — acha o fecho depois do abre
  const abre = src.indexOf('$fn$', ini)
  exigir(abre > ini, `delimitador $fn$ nao encontrado em ${fn}`)
  const fecha = src.indexOf('$fn$;', abre + 4)
  exigir(fecha > abre, `fecho $fn$; nao encontrado em ${fn}`)
  return src.slice(ini, fecha + 5)
}

const GUARD = (nomeVar) => `
    -- ⚠️ ITEM 10 DA AUDITORIA (30/08/2026): a fila pertence a ESTE dispositivo?
    -- O device ja se autenticou por HMAC quando chegou aqui, mas ate 30/08/2026 o \`fila_id\` nao
    -- era conferido contra ele: um relogio legitimo podia confirmar item da fila de OUTRO,
    -- criando vinculo de servidor no equipamento errado. Silencioso dos dois lados.
    -- NULL = chamador antigo, que nao passa o parametro (ver gen_fila_dono.js) — segue sem checar.
    IF p_dispositivo_id IS NOT NULL AND ${nomeVar} IS DISTINCT FROM p_dispositivo_id THEN
        RAISE EXCEPTION 'Item de fila % nao pertence ao dispositivo autenticado.', p_fila_id
            USING ERRCODE = '42501';
    END IF;
`

const ALVOS = [
  {
    fn: 'fn_confirmar_cadastro_rep',
    // assinatura: acrescenta o parametro no fim, ja' com default
    assinaturaDe: `    p_transitorio    boolean DEFAULT false
)`,
    assinaturaPara: `    p_transitorio    boolean DEFAULT false,
    -- O dispositivo que a rota AUTENTICOU por HMAC. Ver o guard no corpo.
    p_dispositivo_id uuid DEFAULT NULL
)`,
    // o guard entra logo depois do SELECT que carrega v_dispositivo_id e do teste de NULL
    ancora: `    IF v_dispositivo_id IS NULL THEN
        RETURN; -- ja processado ou id invalido - idempotente, sem erro (reenvio seguro)
    END IF;
`,
    varDispositivo: 'v_dispositivo_id',
  },
  {
    fn: 'fn_confirmar_remocao_usuario_dispositivo',
    assinaturaDe: `    p_erro    text DEFAULT NULL
)`,
    assinaturaPara: `    p_erro    text DEFAULT NULL,
    -- O dispositivo que a rota AUTENTICOU por HMAC. Ver o guard no corpo.
    p_dispositivo_id uuid DEFAULT NULL
)`,
    // mesma ancora: as duas funcoes carregam v_dispositivo_id e testam NULL do mesmo jeito
    ancora: `    IF v_dispositivo_id IS NULL THEN
        RETURN; -- ja processado ou id invalido - idempotente, sem erro (reenvio seguro)
    END IF;
`,
    varDispositivo: 'v_dispositivo_id',
    // ⚠️ Esta ja tinha REVOKE explicito na migration de origem. A nova assinatura e' um objeto
    // DIFERENTE, entao os GRANTs NAO sao herdados — precisam ser reescritos na migration nova,
    // senao a funcao nasce aberta a PUBLIC (armadilha 24).
    grants: true,
  },
]

let gerados = []

for (const alvo of ALVOS) {
  const arq = vigente(alvo.fn)
  let bloco = extrair(arq, alvo.fn)
  const original = bloco
  const eol = bloco.includes('\r\n') ? '\r\n' : '\n'

  alvo.assinaturaDe = comEol(alvo.assinaturaDe, eol)
  alvo.assinaturaPara = comEol(alvo.assinaturaPara, eol)
  alvo.ancora = comEol(alvo.ancora, eol)
  alvo.guard = comEol(GUARD(alvo.varDispositivo), eol)

  let n = bloco.split(alvo.assinaturaDe).length - 1
  exigir(n === 1, `${alvo.fn}: esperava 1 ocorrencia da assinatura, achei ${n}`)
  bloco = bloco.replace(alvo.assinaturaDe, () => alvo.assinaturaPara)

  n = bloco.split(alvo.ancora).length - 1
  exigir(n === 1, `${alvo.fn}: esperava 1 ocorrencia da ancora, achei ${n}`)
  bloco = bloco.replace(alvo.ancora, () => alvo.ancora + alvo.guard)

  // conferencias estruturais
  exigir(bloco.includes('p_dispositivo_id uuid DEFAULT NULL'), `${alvo.fn}: parametro nao entrou`)
  exigir((bloco.match(/RAISE EXCEPTION 'Item de fila/g) || []).length === 1, `${alvo.fn}: guard duplicado`)
  exigir(bloco.length > original.length, `${alvo.fn}: o bloco encolheu`)
  // o corpo original tem que continuar inteiro dentro do novo
  const semGuard = bloco.replace(alvo.guard, '')
    .replace(alvo.assinaturaPara, alvo.assinaturaDe)
  exigir(semGuard === original, `${alvo.fn}: o corpo divergiu do original (deveria ser copia verbatim + guard)`)

  gerados.push({ fn: alvo.fn, arq, bloco })
  console.log(`  OK  ${alvo.fn}  (de ${path.basename(arq)}, ${original.length} -> ${bloco.length} chars)`)
}

fs.writeFileSync('scratchpad/_fila_dono_blocos.sql',
  gerados.map(g => `-- de ${g.arq}\n${g.bloco}\n`).join('\n'), 'utf8')
console.log('\nblocos gerados em scratchpad/_fila_dono_blocos.sql')
console.log("As duas usam a mesma ancora: carregam v_dispositivo_id e testam NULL do mesmo jeito.")
