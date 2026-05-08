'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/utils/supabase/client'
import { ShieldCheck, MapPin, Navigation, CheckCircle, Loader2, AlertCircle, Clock } from 'lucide-react'
import { useParams } from 'next/navigation'

export default function ProfessionalOvercallPage() {
  const { token } = useParams()
  const [log, setLog] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configs, setConfigs] = useState<Record<string, any>>({})
  const [configsLoaded, setConfigsLoaded] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)

  // Helper to parse config values robustly
  const isConfigTrue = (key: string) => {
    const val = configs[key]
    if (val === undefined || val === null) return false
    return val === true || String(val).toLowerCase() === 'true' || String(val).toLowerCase() === 'sim'
  }
  
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
        const cfg: Record<string, any> = {}
        if (configData) {
          configData.forEach(c => cfg[c.chave] = c.valor)
        }
        setConfigs(cfg)
        setConfigsLoaded(true)

        // Check timeouts immediately on load
        let currentStatus = flattenedData.status
        const now = new Date().getTime()

        if (currentStatus === 'Aguardando' && cfg['sobreaviso_tempo_aceite_minutos']) {
          const limit = parseInt(cfg['sobreaviso_tempo_aceite_minutos'])
          const created = new Date(flattenedData.created_at).getTime()
          const diffMinutes = (now - created) / 60000
          if (diffMinutes > limit) {
            currentStatus = 'Falhou'
            await supabase.from('logs_sobreaviso').update({ 
              status: 'Falhou', 
              motivo_falha: 'Tempo limite para aceite excedido.' 
            }).eq('id', flattenedData.id)
            flattenedData.motivo_falha = 'Tempo limite para aceite excedido.'
          }
        } else if (currentStatus === 'Aceito' && cfg['sobreaviso_tempo_chegada_minutos']) {
          const limit = parseInt(cfg['sobreaviso_tempo_chegada_minutos'])
          const accepted = new Date(flattenedData.data_hora_aceite).getTime()
          const diffMinutes = (now - accepted) / 60000
          if (diffMinutes > limit) {
            currentStatus = 'Falhou'
            await supabase.from('logs_sobreaviso').update({ 
              status: 'Falhou', 
              motivo_falha: 'Tempo limite de deslocamento excedido.' 
            }).eq('id', flattenedData.id)
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

  // Timer Effect (Acceptance or Arrival)
  useEffect(() => {
    if (!status || !log || !configsLoaded) return

    const calculateTime = () => {
      const now = new Date().getTime()
      
      if (status === 'Aguardando' && configs['sobreaviso_tempo_aceite_minutos']) {
        const limit = parseInt(configs['sobreaviso_tempo_aceite_minutos'])
        const created = new Date(log.created_at).getTime()
        const diff = (created + limit * 60000) - now
        return Math.max(0, diff)
      }
      
      if (status === 'Aceito' && configs['sobreaviso_tempo_chegada_minutos']) {
        const limit = parseInt(configs['sobreaviso_tempo_chegada_minutos'])
        const acceptedAt = new Date(log.data_hora_aceite).getTime()
        const diff = (acceptedAt + limit * 60000) - now
        
        if (diff <= 0) {
          if (status === 'Aceito') {
             setStatus('Falhou')
             setLog((prev: any) => ({ ...prev, status: 'Falhou', motivo_falha: 'Tempo limite de deslocamento excedido.' }))
          }
          return 0
        }
        return diff
      }
      
      return null
    }

    const initial = calculateTime()
    setTimeLeft(initial)

    if (initial !== null) {
      const interval = setInterval(() => {
        const remaining = calculateTime()
        setTimeLeft(remaining)
        if (remaining !== null && remaining <= 0) {
          clearInterval(interval)
        }
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [status, log, configsLoaded, configs])

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371e3 
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

    // Robust check - if in doubt, require location
    const requireLocation = !configsLoaded || isConfigTrue('sobreaviso_exigir_localizacao')

    const performAccept = async (lat?: number, long?: number) => {
      // Final security check: if it was required but not provided, ABORT
      if (requireLocation && (!lat || !long)) {
        setError('O GPS é obrigatório para este chamado. Por favor, ative a localização precisa no seu navegador.')
        setLoading(false)
        return
      }

      const supabase = createClient()
      let ip = 'N/A'
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json')
        const ipData = await ipRes.json()
        ip = ipData.ip
      } catch (e) {
        console.warn('Erro ao obter IP:', e)
      }

      const { error: updateError } = await supabase
        .from('logs_sobreaviso')
        .update({
          status: 'Aceito',
          data_hora_aceite: new Date().toISOString(),
          lat_aceite: lat || null,
          long_aceite: long || null,
          user_agent: navigator.userAgent,
          ip_aceite: ip
        })
        .eq('token_magic_link', token)

      if (updateError) {
        setError('Erro ao aceitar: ' + updateError.message)
      } else {
        setStatus('Aceito')
        setLog((prev: any) => ({ ...prev, status: 'Aceito', data_hora_aceite: new Date().toISOString() }))
      }
      setLoading(false)
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => performAccept(pos.coords.latitude, pos.coords.longitude),
        (err) => {
          console.warn('Erro ao obter GPS:', err)
          if (requireLocation) {
            setError('Permissão de GPS negada ou erro ao obter localização. Para este chamado, o GPS é obrigatório.')
            setLoading(false)
          } else {
            performAccept()
          }
        },
        { enableHighAccuracy: true, timeout: 15000 } // Increased timeout to 15s
      )
    } else {
      if (requireLocation) {
        setError('Seu navegador não suporta GPS, que é obrigatório nesta unidade.')
        setLoading(false)
      } else {
        performAccept()
      }
    }
  }

  const handleRegisterArrival = async () => {
    setLoading(true)
    setError(null)

    const requireLocation = !configsLoaded || isConfigTrue('sobreaviso_exigir_localizacao')

    const performArrival = async (lat?: number, long?: number) => {
      if (requireLocation && (!lat || !long)) {
        setError('GPS é obrigatório para validar a chegada.')
        setLoading(false)
        return
      }

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

      let ip = 'N/A'
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json')
        const ipData = await ipRes.json()
        ip = ipData.ip
      } catch (e) {
        console.warn('Erro ao obter IP na chegada:', e)
      }

      const { error: updateError } = await supabase
        .from('logs_sobreaviso')
        .update({
          status: 'Chegou',
          data_hora_chegada: now,
          tipo_validacao_chegada: lat ? 'GPS' : 'Manual',
          lat_chegada: lat || null,
          long_chegada: long || null,
          ip_chegada: ip
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

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => performArrival(pos.coords.latitude, pos.coords.longitude),
        (err) => {
          console.warn('Erro ao obter GPS na chegada:', err)
          if (requireLocation) {
            setError('GPS é obrigatório para validar a chegada e não foi possível obtê-lo.')
            setLoading(false)
          } else {
            performArrival()
          }
        },
        { enableHighAccuracy: true, timeout: 15000 }
      )
    } else {
      if (requireLocation) {
        setError('GPS é obrigatório para validar a chegada e seu navegador não suporta.')
        setLoading(false)
      } else {
        performArrival()
      }
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

  if (loading && !log) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
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
              {log?.servidores?.nome}
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">Você foi acionado para a unidade:</p>
            <div className="inline-flex items-center text-blue-600 font-bold bg-blue-50 dark:bg-blue-900/20 px-4 py-2 rounded-lg">
              <MapPin className="mr-2 h-4 w-4" />
              {log?.unidades?.nome}
            </div>

            {log?.motivo_acionamento && (
              <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-xl border border-amber-200 dark:border-amber-800 text-left">
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase mb-1">Motivo do Acionamento:</p>
                <p className="text-sm text-amber-900 dark:text-amber-200 italic">
                  "{log?.motivo_acionamento}"
                </p>
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800">
            {status === 'Aguardando' && (
              <div className="space-y-4">
                {timeLeft !== null && (
                  <div className={`p-3 rounded-xl border flex items-center justify-center gap-3 transition-all ${
                    timeLeft < 300000 
                      ? 'bg-amber-50 border-amber-200 text-amber-700' 
                      : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                  }`}>
                    <Clock className="h-4 w-4" />
                    <div className="text-center">
                      <p className="text-[9px] uppercase font-bold opacity-70">Tempo restante para aceite:</p>
                      <p className="text-xl font-mono font-bold">{formatTime(timeLeft)}</p>
                    </div>
                  </div>
                )}

                {!showRecuseForm ? (
                  <>
                    <button
                      onClick={handleAccept}
                      disabled={loading || !configsLoaded || timeLeft === 0}
                      className="w-full flex items-center justify-center bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg hover:shadow-green-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle className="mr-3 h-6 w-6" />
                      {loading ? 'Processando...' : 'Aceitar Chamado'}
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
                  {log?.motivo_falha || 'O tempo limite expirou e este chamado foi invalidado.'}
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

                {timeLeft !== null && (
                  <div className={`p-4 rounded-xl border flex items-center justify-center gap-3 transition-all duration-500 ${
                    timeLeft < 300000 
                      ? 'bg-red-50 border-red-200 text-red-600 animate-pulse' 
                      : 'bg-blue-50 border-blue-200 text-blue-600'
                  }`}>
                    <Clock className={`h-5 w-5 ${timeLeft < 300000 ? 'text-red-500' : 'text-blue-500'}`} />
                    <div className="text-center">
                      <p className="text-[10px] uppercase font-bold opacity-70">Tempo restante para chegada:</p>
                      <p className="text-2xl font-black font-mono tracking-tighter">{formatTime(timeLeft)}</p>
                    </div>
                  </div>
                )}

                {!log?.data_hora_chegada ? (
                  <button
                    onClick={handleRegisterArrival}
                    disabled={loading || timeLeft === 0}
                    className="w-full flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg disabled:opacity-50 disabled:grayscale"
                  >
                    <Navigation className="mr-3 h-6 w-6" />
                    {loading ? 'Processando...' : 'Registrar Chegada na Unidade'}
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
