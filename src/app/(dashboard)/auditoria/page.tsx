'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { ShieldCheck, Zap, Clock, MapPin, UserCheck, AlertCircle, Building2 } from 'lucide-react'

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [configs, setConfigs] = useState<Record<string, string>>({})

  useEffect(() => {
    const supabase = createClient()
    
    async function fetchData() {
      // Fetch configs
      const { data: configData } = await supabase.from('configuracoes_globais').select('*')
      if (configData) {
        const obj: Record<string, string> = {}
        configData.forEach(c => { obj[c.chave] = String(c.valor) })
        setConfigs(obj)
      }

      // Fetch logs
      const { data: logsData } = await supabase
        .from('logs_sobreaviso')
        .select('*, servidores(nome), unidades(nome, latitude, longitude)')
        .order('data_hora_acionamento', { ascending: false })
        .limit(20)
      
      if (logsData) setLogs(logsData)
      setLoading(false)
    }

    fetchData()

    // Realtime subscription
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'logs_sobreaviso' },
        () => {
          fetchData()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const [selectedLog, setSelectedLog] = useState<any>(null)

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Aceito': return 'text-green-600 bg-green-50 dark:bg-green-900/20'
      case 'Recusado': return 'text-red-600 bg-red-50 dark:bg-red-900/20'
      case 'Expirado': return 'text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800'
      case 'Falhou': return 'text-red-700 bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800'
      case 'Chegou': return 'text-blue-600 bg-blue-50 dark:bg-blue-900/20'
      default: return 'text-orange-600 bg-orange-50 dark:bg-orange-900/20'
    }
  }

  const getEffectiveStatus = (log: any) => {
    if (!log) return null
    if (log.status === 'Falhou') return 'Falhou'
    
    // Check virtual failure for Accepted -> Arrival
    if (log.status === 'Aceito' && configs['sobreaviso_tempo_chegada_minutos']) {
      const limit = parseInt(configs['sobreaviso_tempo_chegada_minutos'])
      const safeDateStr = log.data_hora_aceite ? log.data_hora_aceite.replace(' ', 'T') : new Date().toISOString()
      const acceptedAt = new Date(safeDateStr).getTime()
      const now = new Date().getTime()
      if ((acceptedAt + limit * 60000) < now && !log.data_hora_chegada) {
        return 'Falhou'
      }
    }

    // Check virtual failure for Triggered -> Accepted
    if (log.status === 'Aguardando' && configs['sobreaviso_tempo_aceite_minutos']) {
      const limit = parseInt(configs['sobreaviso_tempo_aceite_minutos'])
      const safeDateStr = log.created_at ? log.created_at.replace(' ', 'T') : new Date().toISOString()
      const created = new Date(safeDateStr).getTime()
      const now = new Date().getTime()
      if ((created + limit * 60000) < now) {
        return 'Falhou'
      }
    }
    
    return log.status
  }

  const openInGoogleMaps = (lat: number, long: number) => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${long}`, '_blank')
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">Painel de Auditoria</h1>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Monitoramento em tempo real dos acionamentos de sobreaviso.
          </p>
        </div>
        <div className="flex items-center space-x-2 text-sm text-green-600 font-medium">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span>Monitoramento Ativo</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
            <h2 className="text-lg font-semibold flex items-center">
              <Zap className="mr-2 h-5 w-5 text-orange-500" />
              Últimos Acionamentos
            </h2>
          </div>
          
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {logs.map((log) => (
              <div 
                key={log.id} 
                onClick={() => setSelectedLog(log)}
                className="p-6 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-start space-x-4">
                    <div className="mt-1 rounded-full p-2 bg-zinc-100 dark:bg-zinc-800">
                      <UserCheck className="h-5 w-5 text-zinc-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-zinc-900 dark:text-white">
                        {log.servidores?.nome}
                      </h3>
                      <p className="text-sm text-zinc-600 dark:text-zinc-400 flex items-center">
                        <Building2 className="mr-1 h-3 w-3" />
                        {log.unidades?.nome}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-6">
                    <div className="text-xs">
                      <p className="text-zinc-600 dark:text-zinc-400 uppercase tracking-wider font-bold">Acionado</p>
                      <p className="font-medium">{new Date(log.data_hora_acionamento).toLocaleString('pt-BR')}</p>
                      {log.motivo_acionamento && (
                        <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-1 italic">"{log.motivo_acionamento}"</p>
                      )}
                    </div>

                    {log.data_hora_aceite && (
                      <div className="text-xs">
                        <p className="text-zinc-600 dark:text-zinc-400 uppercase tracking-wider font-bold">Aceito</p>
                        <p className="font-medium text-green-600">{new Date(log.data_hora_aceite).toLocaleString('pt-BR')}</p>
                      </div>
                    )}

                    {log.data_hora_chegada && (
                      <div className="text-xs">
                        <p className="text-zinc-600 dark:text-zinc-400 uppercase tracking-wider font-bold">Chegada</p>
                        <p className="font-medium text-blue-600">{new Date(log.data_hora_chegada).toLocaleString('pt-BR')}</p>
                      </div>
                    )}

                    <div className={`rounded-full px-3 py-1 text-xs font-bold ${getStatusColor(getEffectiveStatus(log))}`}>
                      {getEffectiveStatus(log)}
                    </div>

                    {log.motivo_falha && (
                      <div className="text-[10px] text-red-600 font-medium max-w-[150px] truncate" title={log.motivo_falha}>
                        {log.motivo_falha}
                      </div>
                    )}

                    <div className="flex space-x-2">
                      {log.lat_aceite && (
                        <MapPin className="h-4 w-4 text-green-500" />
                      )}
                      {log.lat_chegada && (
                        <MapPin className="h-4 w-4 text-blue-500" />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {(!logs || logs.length === 0) && !loading && (
              <div className="p-12 text-center text-zinc-500 dark:text-zinc-400">
                <Clock className="mx-auto h-12 w-12 opacity-20 mb-4" />
                <p>Nenhum acionamento registrado ainda.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Detalhes */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 flex justify-between items-center">
              <h3 className="text-xl font-bold">Detalhes do Acionamento</h3>
              <button onClick={() => setSelectedLog(null)} className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-white">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="flex items-center space-x-4">
                <div className="h-12 w-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600">
                  <UserCheck className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">Servidor</p>
                  <p className="text-lg font-bold">{selectedLog.servidores?.nome}</p>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{selectedLog.unidades?.nome}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-2">Linha do Tempo</p>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-zinc-600 dark:text-zinc-400">Acionamento:</span>
                      <span className="text-sm font-medium">{new Date(selectedLog.data_hora_acionamento).toLocaleString('pt-BR')}</span>
                    </div>
                    {selectedLog.data_hora_aceite && (
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-sm text-zinc-600 dark:text-zinc-400">
                            {selectedLog.status === 'Recusado' ? 'Recusa:' : 'Aceite:'}
                          </span>
                          {(selectedLog.lat_aceite || selectedLog.lat_recusa) && (
                            <button 
                              onClick={() => openInGoogleMaps(
                                selectedLog.status === 'Recusado' ? selectedLog.lat_recusa : selectedLog.lat_aceite, 
                                selectedLog.status === 'Recusado' ? selectedLog.long_recusa : selectedLog.long_aceite
                              )}
                              className="ml-2 text-[10px] text-blue-600 hover:underline flex items-center"
                            >
                              <MapPin className="h-3 w-3 mr-0.5" /> Ver no Mapa
                            </button>
                          )}
                        </div>
                        <span className={`text-sm font-medium ${selectedLog.status === 'Recusado' ? 'text-red-600' : 'text-green-600'}`}>
                          {new Date(selectedLog.data_hora_aceite).toLocaleString('pt-BR')}
                        </span>
                      </div>
                    )}
                    {selectedLog.data_hora_chegada && (
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-sm text-zinc-600 dark:text-zinc-400">Chegada:</span>
                          <button 
                            onClick={() => openInGoogleMaps(selectedLog.lat_chegada, selectedLog.long_chegada)}
                            className="ml-2 text-[10px] text-blue-600 hover:underline flex items-center"
                          >
                            <MapPin className="h-3 w-3 mr-0.5" /> Ver no Mapa
                          </button>
                        </div>
                        <span className="text-sm font-medium text-blue-600">{new Date(selectedLog.data_hora_chegada).toLocaleString('pt-BR')}</span>
                      </div>
                    )}
                  </div>
                </div>

                {selectedLog.motivo_acionamento && (
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-800">
                    <p className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase mb-1">Motivo do Chamado</p>
                    <p className="text-sm text-blue-900 dark:text-blue-200 italic">"{selectedLog.motivo_acionamento}"</p>
                  </div>
                )}

                {selectedLog.status === 'Recusado' && selectedLog.justificativa_recusa && (
                  <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-xl border border-red-100 dark:border-red-800">
                    <p className="text-xs font-bold text-red-700 dark:text-red-400 uppercase mb-1">Justificativa da Recusa</p>
                    <p className="text-sm text-red-900 dark:text-red-200 italic">"{selectedLog.justificativa_recusa}"</p>
                  </div>
                )}

                <div className="bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase mb-2">Dados Técnicos</p>
                  <div className="space-y-2 text-[11px] font-mono text-zinc-600 dark:text-zinc-400">
                    <p>Status: {selectedLog.status}</p>
                    <p>IP Aceite: {selectedLog.ip_aceite || 'N/A'}</p>
                    <p className="truncate">Browser: {selectedLog.user_agent || 'N/A'}</p>
                    <p>Token: {selectedLog.token_magic_link}</p>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setSelectedLog(null)}
                className="w-full py-3 bg-zinc-900 dark:bg-white dark:text-zinc-900 text-white font-bold rounded-xl hover:opacity-90 transition-opacity"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
