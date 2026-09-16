import { env } from './_env.mjs'

async function testStatusPonto() {
  const e = env('.env.production')
  const headers = { apikey: e.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + e.SUPABASE_SERVICE_ROLE_KEY }

  const unidadeId = '3db937fc-f479-41f8-9973-5a9be14f08a7' // CAPS III
  const setorId = '758920d8-2b8f-45ea-986d-2649f2a5a656' // ADMINISTRAÇÃO

  // 1. Relógios REP ativos
  const dRes = await fetch(e.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/dispositivos_rep?ativo=eq.true&select=id,nome,unidade_id,atende_toda_unidade', { headers })
  const todosDispositivos = await dRes.json()

  // 2. Setores dos dispositivos
  const dsRes = await fetch(e.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/dispositivos_rep_setores?select=dispositivo_id,setor_id', { headers })
  const dispSetores = await dsRes.json()

  const relogiosDoSetor = todosDispositivos.filter(d =>
    (d.atende_toda_unidade && d.unidade_id === unidadeId) ||
    dispSetores.some(ds => ds.dispositivo_id === d.id && ds.setor_id === setorId)
  )

  console.log('=== TESTE DE STATUS DE PONTO (REP E TERMINAL) ===')
  console.log('Unidade: CAPS III')
  console.log('Relógios do Setor:', relogiosDoSetor.map(r => r.nome))

  // 3. Servidores da Escala
  const nomesAlvo = ['ERIKA CASTRO MORAIS', 'RAPHAEL DE ALMEIDA SILVA', 'JONAS DE SOUSA FERREIRA NORATO', 'SONIA LEIA DOS SANTOS']
  for (const n of nomesAlvo) {
    const sRes = await fetch(e.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/servidores?nome=ilike.*' + encodeURIComponent(n.split(' ')[0] + '%' + n.split(' ')[1]) + '*&select=id,nome,matricula,pin_acesso', { headers })
    const servidores = await sRes.json()
    const s = servidores[0]
    if (!s) continue

    const uRes = await fetch(e.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/rep_usuarios_dispositivo?servidor_id=eq.' + s.id + '&select=dispositivo_id,tem_biometria', { headers })
    const usuarios = await uRes.json()

    const devMap = new Map(todosDispositivos.map(d => [d.id, d]))
    const setorDevIds = new Set(relogiosDoSetor.map(r => r.id))

    const prontos = usuarios.filter(u => u.tem_biometria && devMap.has(u.dispositivo_id)).map(u => devMap.get(u.dispositivo_id).nome)
    const semBio = usuarios.filter(u => !u.tem_biometria && devMap.has(u.dispositivo_id)).map(u => devMap.get(u.dispositivo_id).nome)

    let situacaoRep = 'fora_do_relogio'
    if (prontos.length > 0) situacaoRep = 'pronto'
    else if (semBio.length > 0) situacaoRep = 'sem_biometria'
    else if (relogiosDoSetor.length === 0) situacaoRep = 'sem_relogio_setor'

    const temPin = !!s.pin_acesso
    const situacaoTerminal = temPin ? 'pronto' : 'sem_pin'

    console.log(`\nServidor: ${s.nome} (MAT ${s.matricula})`)
    console.log(`  🕒 REP: [${situacaoRep.toUpperCase()}]`)
    console.log(`     - Prontos (${prontos.length}): ${prontos.join(', ') || 'Nenhum'}`)
    console.log(`     - Sem Biometria (${semBio.length}): ${semBio.join(', ') || 'Nenhum'}`)
    console.log(`  💻 TERMINAL: [${situacaoTerminal.toUpperCase()}] (PIN: ${temPin ? 'SIM' : 'NÃO'})`)
  }
}

testStatusPonto().catch(console.error)
