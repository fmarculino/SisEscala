'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { ShieldCheck, MapPin, Navigation, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import { useParams } from 'next/navigation'

export default function ProfessionalOvercallPage() {
  const { token } = useParams()
  const [log, setLog] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configs, setConfigs] = useState<Record<string, string>>({})
  
  useEffect(() => {
    const supabase = createClient()
    async function fetchLog() {
      const { data, error } = await supabase
        .rpc('get_sobreaviso_details', { magic_token: token })
      
      if (error || !data) {
        console.error('Supabase error:', error)
        setError(`Link inválido ou expirado. Detalhe: ${error?.message || 'Chamado não encontrado no banco de dados.'}`)
      } else {
        const flattenedData = {
          ...data.log,
          servidores: data.servidores,
          unidades: data.unidades
        }
        
        // Fetch configs
        const { data: configData } = await supabase.from('configuracoes_globais').select('chave, valor')
        const cfg: Record<string, string> = {}
        if (configData) {
          configData.forEach(c => cfg[c.chave] = c.valor)
        }
        setConfigs(cfg)

        // Check timeouts
        let currentStatus = flattenedData.status
        if (currentStatus === 'Aguardando' && cfg['sobreaviso_tempo_aceite_minutos']) {
          const limit = parseInt(cfg['sobreaviso_tempo_aceite_minutos'])
          const created = new Date(flattenedData.created_at)
          const diffMinutes = (new Date().getTime() - created.getTime()) / 60000
          if (diffMinutes > limit) {
            currentStatus = 'Falhou'
            await supabase.from('logs_sobreaviso').update({ status: 'Falhou', motivo_falha: 'Tempo limite para aceite excedido.' }).eq('id', flattenedData.id)
            flattenedData.motivo_falha = 'Tempo limite para aceite excedido.'
          }
        } else if (currentStatus === 'Aceito' && cfg['sobreaviso_tempo_chegada_minutos']) {
          const limit = parseInt(cfg['sobreaviso_tempo_chegada_minutos'])
          const accepted = new Date(flattenedData.data_hora_aceite)
          const diffMinutes = (new Date().getTime() - accepted.getTime()) / 60000
          if (diffMinutes > limit) {
            currentStatus = 'Falhou'
            await supabase.from('logs_sobreaviso').update({ status: 'Falhou', motivo_falha: 'Tempo limite de deslocamento excedido.' }).eq('id', flattenedData.id)
            flattenedData.motivo_falha = 'Tempo limite de deslocamento excedido.'
          }
        }
        
        flattenedData.status = currentStatus
        setLog(flattenedData)
        setStatus(currentStatus)
      }
      setLoading(false)
    }

    fetchLog()
  }, [token])

  // Helper to calculate distance in meters
  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3 // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180
    const φ2 = lat2 * Math.PI / 180
    const Δφ = (lat2 - lat1) * Math.PI / 180
    const Δλ = (lon2 - lon1) * Math.PI / 180

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return R * c
  }

  const handleAccept = async () => {
    setLoading(true)
    setError(null)

    const requireLocation = configs['sobreaviso_exigir_localizacao'] === 'true'

    if (requireLocation && !navigator.geolocation) {
      setError('A configuração exige GPS para aceitar o chamado e seu navegador não suporta.')
      setLoading(false)
      return
    }

    const performAccept = async (lat?: number, long?: number) => {
      const supabase = createClient()
      const { error: updateError } = await supabase
        .from('logs_sobreaviso')
        .update({
          status: 'Aceito',
          data_hora_aceite: new Date().toISOString(),
          lat_aceite: lat || null,
          long_aceite: long || null,
          user_agent: navigator.userAgent
        })
        .eq('token_magic_link', token)

      if (updateError) {
        setError('Erro ao aceitar: ' + updateError.message)
      } else {
        setStatus('Aceito')
      }
      setLoading(false)
    }

    if (requireLocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => performAccept(pos.coords.latitude, pos.coords.longitude),
        () => {
          setError('Permissão de GPS negada. Por favor, habilite o acesso à sua localização para confirmar o chamado.')
          setLoading(false)
        }
      )
    } else {
      performAccept()
    }
  }

  const handleRegisterArrival = async () => {
    setLoading(true)
    setError(null)

    const requireLocation = configs['sobreaviso_exigir_localizacao'] === 'true'

    if (requireLocation && !navigator.geolocation) {
      setError('GPS é obrigatório para validar a chegada.')
      setLoading(false)
      return
    }

    const performArrival = async (lat?: number, long?: number) => {
      if (lat && long) {
        const unitLat = log.unidades?.latitude
        const unitLong = log.unidades?.longitude
        const radius = log.unidades?.raio_geofence || 500

        if (unitLat && unitLong) {
          const distance = getDistance(lat, long, unitLat, unitLong)
          if (distance > radius) {
            alert(`Você está a ${Math.round(distance)}m da unidade. A chegada só pode ser registrada num raio de ${radius}m.`)
            setLoading(false)
            return
          }
        }
      }
      
      const now = new Date().toISOString()
      const supabase = createClient()
      const { error: updateError } = await supabase
        .from('logs_sobreaviso')
        .update({
          status: 'Chegou',
          data_hora_chegada: now,
          tipo_validacao_chegada: lat ? 'GPS' : 'Manual',
          lat_chegada: lat || null,
          long_chegada: long || null
        })
        .eq('token_magic_link', token)

      if (updateError) {
        setError('Erro ao registrar chegada: ' + updateError.message)
      } else {
        alert('Chegada registrada com sucesso!')
        setStatus('Chegou')
        setLog((prev: any) => ({ ...prev, status: 'Chegou', data_hora_chegada: now }))
      }
      setLoading(false)
    }

    if (requireLocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => performArrival(pos.coords.latitude, pos.coords.longitude),
        (err) => {
          setError('Erro ao obter GPS: ' + err.message + '. Por favor, habilite a localização.')
          setLoading(false)
        }
      )
    } else {
      performArrival()
    }
  }

  const [showRecuseForm, setShowRecuseForm] = useState(false)
  const [justificativa, setJustificativa] = useState('')

  const handleDecline = async () => {
    if (!justificativa.trim()) {
      alert('Por favor, informe o motivo da recusa.')
      return
    }

    setLoading(true)
    
    const performUpdate = async (lat?: number, long?: number) => {
      const supabase = createClient()
      const { error: updateError } = await supabase
        .from('logs_sobreaviso')
        .update({
          status: 'Recusado',
          justificativa_recusa: justificativa,
          data_hora_aceite: new Date().toISOString(),
          lat_recusa: lat || null,
          long_recusa: long || null
        })
        .eq('token_magic_link', token)

      if (updateError) {
        setError('Erro ao recusar: ' + updateError.message)
      } else {
        setStatus('Recusado')
      }
      setLoading(false)
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => performUpdate(pos.coords.latitude, pos.coords.longitude),
        () => performUpdate()
      )
    } else {
      performUpdate()
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
  if (error) return <div className="flex min-h-screen items-center justify-center p-4"><div className="bg-red-50 p-6 rounded-xl text-red-700 flex items-center"><AlertCircle className="mr-3" /> {error}</div></div>

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800">
        <div className="bg-blue-600 p-8 text-white text-center">
          <ShieldCheck className="h-16 w-16 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Acionamento de Sobreaviso</h1>
          <p className="opacity-80">SisEscala - Auditoria Digital</p>
        </div>

        <div className="p-8 space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
              {log.servidores?.nome}
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">Você foi acionado para a unidade:</p>
            <div className="inline-flex items-center text-blue-600 font-bold bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-lg">
              <MapPin className="mr-2 h-4 w-4" />
              {log.unidades?.nome}
            </div>

            {log.motivo_acionamento && (
              <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800 text-left">
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase mb-1">Motivo do Acionamento:</p>
                <p className="text-sm text-amber-900 dark:text-amber-200 italic">
                  "{log.motivo_acionamento}"
                </p>
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
            {status === 'Aguardando' && (
              <div className="space-y-4">
                {!showRecuseForm ? (
                  <>
                    <button
                      onClick={handleAccept}
                      disabled={loading}
                      className="w-full flex items-center justify-center bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg hover:shadow-green-500/50"
                    >
                      <CheckCircle className="mr-3 h-6 w-6" />
                      Aceitar Chamado
                    </button>
                    <button
                      onClick={() => setShowRecuseForm(true)}
                      disabled={loading}
                      className="w-full text-sm text-zinc-600 dark:text-zinc-400 hover:text-red-600 font-medium py-2 transition-colors"
                    >
                      Não posso atender agora
                    </button>
                  </>
                ) : (
                  <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                        Justificativa da Recusa
                      </label>
                      <textarea
                        autoFocus
                        placeholder="Explique o motivo por não poder atender..."
                        value={justificativa}
                        onChange={(e) => setJustificativa(e.target.value)}
                        className="w-full h-24 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 p-3 text-sm outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                    <div className="flex space-x-3">
                      <button
                        onClick={() => setShowRecuseForm(false)}
                        className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-bold rounded-xl"
                      >
                        Voltar
                      </button>
                      <button
                        onClick={handleDecline}
                        disabled={loading || !justificativa.trim()}
                        className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all disabled:opacity-50"
                      >
                        Confirmar Recusa
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {status === 'Recusado' && (
              <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-xl text-center space-y-2">
                <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-2" />
                <h3 className="text-lg font-bold text-red-800 dark:text-red-400">Chamado Recusado</h3>
                <p className="text-sm text-red-600 dark:text-red-300">
                  Sua justificativa foi enviada para a unidade.
                </p>
              </div>
            )}

            {status === 'Falhou' && (
              <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-xl text-center space-y-2 border border-red-200 dark:border-red-800">
                <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-2" />
                <h3 className="text-lg font-bold text-red-800 dark:text-red-400">Chamado Falhou</h3>
                <p className="text-sm text-red-600 dark:text-red-300">
                  {log.motivo_falha || 'O tempo limite expirou e este chamado foi invalidado.'}
                </p>
              </div>
            )}

            {status === 'Chegou' && (
              <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-xl text-center space-y-2 border border-blue-200 dark:border-blue-800">
                <CheckCircle className="h-12 w-12 text-blue-600 mx-auto mb-2" />
                <h3 className="text-lg font-bold text-blue-800 dark:text-blue-400">Chegada Confirmada</h3>
                <p className="text-sm text-blue-600 dark:text-blue-300">
                  Obrigado por confirmar sua presença.
                </p>
              </div>
            )}

            {status === 'Aceito' && (
              <div className="space-y-4">
                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-xl text-green-700 dark:text-green-400 text-center font-medium">
                  Chamado Aceito! Dirija-se à unidade.
                </div>
                {!log.data_hora_chegada ? (
                  <button
                    onClick={handleRegisterArrival}
                    className="w-full flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg"
                  >
                    <Navigation className="mr-3 h-6 w-6" />
                    Registrar Chegada na Unidade
                  </button>
                ) : (
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl text-blue-700 dark:text-blue-400 text-center font-medium">
                    Chegada registrada às {new Date(log.data_hora_chegada).toLocaleTimeString()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
