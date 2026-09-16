'use server'

import { createAdminClient } from '@/utils/supabase/server'

export interface DispositivoRepInfo {
  id: string
  nome: string
  temBiometria: boolean
  atendeSetor: boolean
  atendeUnidade: boolean
}

export interface TerminalInfo {
  id: string
  nome: string
  atendeSetor: boolean
  atendeUnidade: boolean
}

export interface ServidorPontoStatus {
  servidorId: string
  rep: {
    situacao: 'pronto' | 'sem_biometria' | 'fora_do_relogio' | 'sem_relogio_setor'
    prontos: DispositivoRepInfo[]
    semBiometria: DispositivoRepInfo[]
    todosAlocados: DispositivoRepInfo[]
    relogiosDoSetor: { id: string; nome: string }[]
    setorPossuiRelogio: boolean
  }
  terminal: {
    situacao: 'pronto' | 'sem_pin' | 'sem_terminal'
    temPin: boolean
    terminaisDoSetor: TerminalInfo[]
    unidadePossuiTerminal: boolean
  }
}

/**
 * Consulta o status de Relógios REP e Terminais para uma lista de servidores
 * no escopo da escala de uma unidade e setor específicos.
 */
export async function buscarStatusPontoServidores(
  servidorIds: string[],
  unidadeId: string,
  setorId: string
): Promise<Record<string, ServidorPontoStatus>> {
  if (!servidorIds || servidorIds.length === 0) {
    return {}
  }

  const supabase = await createAdminClient()

  // 1. Relógios REP ativos
  const { data: todosDispositivos } = await supabase
    .from('dispositivos_rep')
    .select('id, nome, unidade_id, atende_toda_unidade')
    .eq('ativo', true)

  const dispositivosAtivos = todosDispositivos || []

  // 2. Setores atendidos por relógios
  const { data: dispSetores } = await supabase
    .from('dispositivos_rep_setores')
    .select('dispositivo_id, setor_id')

  const relacoesSetor = dispSetores || []

  // Relógios que cobrem este setor especificamente
  const relogiosDoSetor = dispositivosAtivos.filter(d =>
    (d.atende_toda_unidade && d.unidade_id === unidadeId) ||
    relacoesSetor.some(ds => ds.dispositivo_id === d.id && ds.setor_id === setorId)
  )
  const relogiosDoSetorIds = new Set(relogiosDoSetor.map(r => r.id))
  const devMap = new Map(dispositivosAtivos.map(d => [d.id, d]))

  // 3. Terminais de presença locais ativos
  const { data: todosTerminais } = await supabase
    .from('terminais_locais')
    .select('id, nome, unidade_id, setor_id')
    .eq('ativo', true)

  const terminaisAtivos = todosTerminais || []
  const terminaisDoSetor: TerminalInfo[] = terminaisAtivos
    .filter(t => t.unidade_id === unidadeId && (!t.setor_id || t.setor_id === setorId))
    .map(t => ({
      id: t.id,
      nome: t.nome,
      atendeSetor: !t.setor_id || t.setor_id === setorId,
      atendeUnidade: t.unidade_id === unidadeId,
    }))

  const unidadePossuiTerminal = terminaisDoSetor.length > 0

  // 4. Usuários cadastrados no snapshot dos relógios REP
  // Dividir em lotes se a lista de servidores for grande
  const maxLote = 200
  let usuariosSnapshot: Array<{ servidor_id: string; dispositivo_id: string; tem_biometria: boolean }> = []
  
  for (let i = 0; i < servidorIds.length; i += maxLote) {
    const lote = servidorIds.slice(i, i + maxLote)
    const { data: usuariosLote } = await supabase
      .from('rep_usuarios_dispositivo')
      .select('servidor_id, dispositivo_id, tem_biometria')
      .in('servidor_id', lote)
    
    if (usuariosLote) {
      usuariosSnapshot = usuariosSnapshot.concat(usuariosLote as any[])
    }
  }

  // 5. Status de PIN dos servidores (pin_acesso != null)
  let servidoresPinMap = new Map<string, boolean>()
  for (let i = 0; i < servidorIds.length; i += maxLote) {
    const lote = servidorIds.slice(i, i + maxLote)
    const { data: servLote } = await supabase
      .from('servidores')
      .select('id, pin_acesso')
      .in('id', lote)
    
    if (servLote) {
      servLote.forEach(s => servidoresPinMap.set(s.id, !!s.pin_acesso))
    }
  }

  // 6. Montar status consolidado para cada servidor
  const resultado: Record<string, ServidorPontoStatus> = {}

  for (const sId of servidorIds) {
    const sUsers = usuariosSnapshot.filter(u => u.servidor_id === sId && devMap.has(u.dispositivo_id))

    const todosAlocados: DispositivoRepInfo[] = sUsers.map(u => {
      const d = devMap.get(u.dispositivo_id)!
      return {
        id: d.id,
        nome: d.nome,
        temBiometria: !!u.tem_biometria,
        atendeSetor: relogiosDoSetorIds.has(d.id),
        atendeUnidade: d.unidade_id === unidadeId,
      }
    })

    const prontos = todosAlocados.filter(u => u.temBiometria)
    const semBiometria = todosAlocados.filter(u => !u.temBiometria)

    // Classificação da situação no relógio REP
    let situacaoRep: ServidorPontoStatus['rep']['situacao']
    if (prontos.length > 0) {
      situacaoRep = 'pronto'
    } else if (semBiometria.length > 0) {
      situacaoRep = 'sem_biometria'
    } else if (relogiosDoSetor.length === 0) {
      situacaoRep = 'sem_relogio_setor'
    } else {
      situacaoRep = 'fora_do_relogio'
    }

    // Classificação da situação no terminal de presença
    const temPin = servidoresPinMap.get(sId) ?? false
    let situacaoTerminal: ServidorPontoStatus['terminal']['situacao']
    if (temPin) {
      situacaoTerminal = 'pronto'
    } else {
      situacaoTerminal = 'sem_pin'
    }

    resultado[sId] = {
      servidorId: sId,
      rep: {
        situacao: situacaoRep,
        prontos,
        semBiometria,
        todosAlocados,
        relogiosDoSetor: relogiosDoSetor.map(r => ({ id: r.id, nome: r.nome })),
        setorPossuiRelogio: relogiosDoSetor.length > 0,
      },
      terminal: {
        situacao: situacaoTerminal,
        temPin,
        terminaisDoSetor,
        unidadePossuiTerminal,
      },
    }
  }

  return resultado
}

/**
 * Consulta o status de um servidor individual (ex: ao adicionar servidor externo à grade).
 */
export async function buscarStatusPontoServidor(
  servidorId: string,
  unidadeId: string,
  setorId: string
): Promise<ServidorPontoStatus | null> {
  const mapa = await buscarStatusPontoServidores([servidorId], unidadeId, setorId)
  return mapa[servidorId] || null
}
