import { normalizarRegistrosFolha } from '../src/utils/folha/normalizarHorarios.ts'

// NUNCA embutir a chave aqui. Este repositorio e PUBLICO, e a service_role key ignora a RLS
// por completo -- quem a tem le e escreve tudo, inclusive auth.users. A versao anterior deste
// arquivo trazia a chave de homologacao literal e foi detectada pelo GitGuardian em 21/08/2026;
// a chave teve de ser rotacionada, porque apagar do git nao desfaz o que ja e publico (o repo
// tem fork, e o GitHub guarda objetos de commits antigos).
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/corrigir_folhas_banco.mjs
// (ou deixe que ele leia .env.local, que esta no .gitignore)
import { readFileSync } from 'node:fs'

function lerEnv(arquivo) {
  try {
    return Object.fromEntries(
      readFileSync(arquivo, 'utf8')
        .split(/\r?\n/)
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
    )
  } catch {
    return {}
  }
}

const env = { ...lerEnv('.env.local'), ...process.env }
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (env ou .env.local).')
  process.exit(1)
}

// Este script ESCREVE em folha_ponto. Confirme em qual banco voce esta antes de rodar --
// homologacao e producao sao bancos diferentes (armadilha 3 do CLAUDE.md).
console.log('Banco alvo:', SUPABASE_URL)

function isFaltaDefinitiva(observacao) {
  if (!observacao) return false
  const upper = observacao.toUpperCase()
  return upper.includes('FALTA') && !upper.includes('AGUARDANDO JUSTIFICATIVA')
}

async function run() {
  console.log('=================================================================')
  console.log('🚀 INICIANDO VARREDURA E CORREÇÃO AUTOMÁTICA EM LOTE NO BANCO')
  console.log('=================================================================\n')

  const url = `${SUPABASE_URL}/rest/v1/folha_ponto?select=id,mes,ano,status,servidor_id,servidores(nome,matricula),registros,escala_mensal(jornadas(horas_totais,nome,intervalo_minutos))&limit=500`
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  })
  
  if (!res.ok) {
    console.error('Erro ao buscar folhas de ponto:', await res.text())
    return
  }

  const folhas = await res.json()
  console.log(`Total de folhas de ponto no banco: ${folhas.length}\n`)

  let totalCorrigidas = 0
  let totalDiasCorrigidos = 0

  for (const folha of folhas) {
    const jornadaInfo = folha.escala_mensal?.jornadas || null
    const normalizacao = normalizarRegistrosFolha(folha.registros, folha.mes, folha.ano, jornadaInfo)

    if (normalizacao.diasCorrigidos > 0) {
      console.log(`🔧 Corrigindo folha de ${folha.servidores?.nome || folha.servidor_id} (${folha.mes}/${folha.ano}) - ${normalizacao.diasCorrigidos} dia(s) afetado(s):`)
      for (const d of normalizacao.detalhes) {
        console.log(`   • Dia ${String(d.dia).padStart(2, '0')}: ${d.motivo}`)
      }

      // Recalcular totais consolidados da folha
      const horasNormaisDiarias = jornadaInfo?.horas_totais ?? 8
      let totalHorasNormais = 0
      let totalExtra50 = 0
      let totalExtra100 = 0
      let totalFaltas = 0

      normalizacao.registros.forEach((r) => {
        if (r.turno_codigo) totalHorasNormais += horasNormaisDiarias
        if (isFaltaDefinitiva(r.observacao)) totalFaltas++
        if (r.hora_extra_minutos && r.hora_extra_minutos > 0) {
          if (r.hora_extra_tipo === '100%') totalExtra100 += r.hora_extra_minutos
          else totalExtra50 += r.hora_extra_minutos
        }
      })

      // Atualizar no banco
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/folha_ponto?id=eq.${folha.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          registros: normalizacao.registros,
          total_horas_normais: parseFloat(totalHorasNormais.toFixed(2)),
          total_horas_extras_50: parseFloat((totalExtra50 / 60).toFixed(2)),
          total_horas_extras_100: parseFloat((totalExtra100 / 60).toFixed(2)),
          total_faltas: totalFaltas,
          ultima_edicao_em: new Date().toISOString()
        })
      })

      if (!updateRes.ok) {
        console.error(`   ❌ Falha ao atualizar folha ${folha.id}:`, await updateRes.text())
      } else {
        console.log(`   ✅ Salvo com sucesso! Novos totais -> Extra 50%: ${(totalExtra50/60).toFixed(1)}h | Extra 100%: ${(totalExtra100/60).toFixed(1)}h | Faltas: ${totalFaltas}\n`)
        totalCorrigidas++
        totalDiasCorrigidos += normalizacao.diasCorrigidos
      }
    }
  }

  console.log('=================================================================')
  console.log(`🎉 VARREDURA CONCLUÍDA!`)
  console.log(`Total de Folhas Corrigidas: ${totalCorrigidas}`)
  console.log(`Total de Dias Normalizados: ${totalDiasCorrigidos}`)
  console.log('=================================================================')
}

run()
