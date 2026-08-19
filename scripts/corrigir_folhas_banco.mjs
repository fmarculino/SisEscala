import { normalizarRegistrosFolha } from '../src/utils/folha/normalizarHorarios.ts'

const SUPABASE_URL = 'https://mtgfmxsbsyknotvwzdcr.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10Z2ZteHNic3lrbm90dnd6ZGNyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDM0NTU0OSwiZXhwIjoyMDk1OTIxNTQ5fQ.fdz9Ios0JLLHg_0mIJHkqZhIWGfaNwgvSg8hI_DfRZQ'

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
