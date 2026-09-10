// Valida o PORTAO: injeta regressoes de proposito na migration e exige que
// scratchpad/sim_hora_eixo_do_dia.js REPROVE cada uma.
//
// Portao que nunca falha nao vale nada. E injecao que nao muda o texto "passa" sem ter testado
// coisa alguma (armadilha 48) — por isso cada substituicao aqui e conferida antes de rodar.
//
// Uso: node scratchpad/val_sim_hora_eixo_do_dia.js
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const MIGRATION = 'supabase/migrations/20260910110000_hora_prevista_no_eixo_do_dia.sql'
const original = fs.readFileSync(MIGRATION, 'utf8')
const EOL = original.includes('\r\n') ? '\r\n' : '\n'
const L = (...linhas) => linhas.join(EOL)

const REGRESSOES = [
  {
    nome: 'guard (b) removido — qualquer hora da madrugada passa a ser adivinhada',
    de: L('    IF p_hora <> p_reg_fim THEN',
          '        RETURN false;',
          '    END IF;'),
    para: L('    IF false THEN',
            '        RETURN false;',
            '    END IF;'),
  },
  {
    nome: 'guard (c) afrouxado de >= para > — o plantao ambiguo passa a subir de dia',
    de: '    IF p_hora + COALESCE(p_duracao, 0) >= p_reg_ini THEN',
    para: '    IF p_hora + COALESCE(p_duracao, 0) > p_reg_ini THEN',
  },
  {
    nome: 'guard (a) removido — jornada diurna passa a subir de dia',
    de: L('    IF p_reg_fim >= p_reg_ini THEN',
          '        RETURN false;',
          '    END IF;'),
    para: L('    IF false THEN',
            '        RETURN false;',
            '    END IF;'),
  },
  {
    nome: 'guard de duracao removido — turno sem duracao passa a subir de dia',
    de: L('    IF COALESCE(p_duracao, 0) <= 0 THEN',
          '        RETURN false;',
          '    END IF;'),
    para: L('    IF false THEN',
            '        RETURN false;',
            '    END IF;'),
  },
  {
    nome: 'envelope perde o + 24 — a correcao inteira vira no-op silencioso',
    de: '        RETURN v_hora + 24;',
    para: '        RETURN v_hora;',
  },
  {
    nome: 'envelope deixa de ler o Regular DO DIA',
    de: '    v_reg := public.fn_obter_horario_regular_dia(p_escala_mensal_id, p_dia);',
    para: '    v_reg := public.fn_obter_horario_regular_dia(p_escala_mensal_id, 1);',
  },
  {
    nome: 'um dos quatro cursores fica para tras com a leitura antiga',
    de: L('                     THEN public.fn_hora_prevista_no_eixo_do_dia(',
          '                          em.id, ed.dia, ed.hora_inicio_prevista, dt.horas_computadas) END,'),
    para: '                     THEN extract(hour from ed.hora_inicio_prevista)::integer END,',
    umaVez: true,
  },
  {
    nome: 'funcao nova sem REVOKE de PUBLIC — nasce aberta a anon (armadilha 24)',
    de: L('REVOKE ALL ON FUNCTION public.fn_hora_prevista_no_eixo_do_dia(uuid, integer, time, numeric)',
          '    FROM PUBLIC, anon, authenticated;'),
    para: '-- REVOKE removido de proposito',
  },
  {
    nome: 'conferencia deixa de EXECUTAR fn_blocos_previstos_dia (armadilha 42)',
    de: '        PERFORM * FROM public.fn_blocos_previstos_dia(v_serv, v_data);',
    para: "        RAISE NOTICE 'existe';",
  },
  {
    nome: 'conferencia perde o sentido que NAO pode disparar',
    de: '    IF public.fn_hora_prevista_dia_seguinte(7, 12, 19, 7) THEN',
    para: '    IF false THEN',
  },
]

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'val-hora-eixo-'))
let reprovou = 0

for (const r of REGRESSOES) {
  const ocorrencias = original.split(r.de).length - 1
  if (ocorrencias === 0) {
    console.error(`ABORTADO: a ancora da regressao "${r.nome}" nao existe na migration.`)
    console.error('  A injecao seria um no-op e o validador "passaria" sem ter testado nada.')
    process.exit(1)
  }
  const alvo = r.umaVez ? 1 : ocorrencias
  const mutado = r.umaVez
    ? original.replace(r.de, () => r.para)
    : original.split(r.de).join(r.para)
  if (mutado === original) {
    console.error(`ABORTADO: a regressao "${r.nome}" nao mudou o texto.`)
    process.exit(1)
  }

  const arquivo = path.join(tmp, 'mutada.sql')
  fs.writeFileSync(arquivo, mutado)

  let saiuComErro = false
  let saida = ''
  try {
    saida = execFileSync(process.execPath, ['scratchpad/sim_hora_eixo_do_dia.js', arquivo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    saiuComErro = true
    saida = String(e.stdout || '') + String(e.stderr || '')
  }

  if (saiuComErro) {
    reprovou++
    const motivo = (saida.match(/(REPROVADO|ABORTADO):.*/g) || ['(sem motivo impresso)'])[0].trim()
    console.log(`  OK  reprovou: ${r.nome}`)
    console.log(`      -> ${motivo.slice(0, 130)}`)
  } else {
    console.error(`  FALHOU: o portao APROVOU a regressao "${r.nome}" (${alvo} substituicao(oes) aplicada(s))`)
  }
}

fs.rmSync(tmp, { recursive: true, force: true })

console.log('')
if (reprovou !== REGRESSOES.length) {
  console.error(`VALIDACAO REPROVADA: ${reprovou}/${REGRESSOES.length} regressoes detectadas.`)
  process.exit(1)
}
console.log(`OK — o portao reprova as ${REGRESSOES.length} regressoes injetadas.`)
