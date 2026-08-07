'use client'

import { useState, useEffect } from 'react'
import { MessageSquare, Mail, Server, Send, Eye, EyeOff, CheckCircle2, Shield, Info } from 'lucide-react'
import { testWhatsAppConnectionAction, testEmailConnectionAction } from '@/app/actions/communication'
import { useDialog } from '@/components/ui/DialogProvider'

export interface UnidadeCommunicationConfig {
  usar_global: boolean
  whatsapp_modo?: string
  whatsapp_astracall_url?: string
  whatsapp_astracall_sid?: string
  whatsapp_astracall_key?: string
  email_smtp_habilitado?: string
  email_smtp_host?: string
  email_smtp_porta?: string
  email_smtp_usuario?: string
  email_smtp_senha?: string
  email_smtp_remetente_email?: string
  email_smtp_remetente_nome?: string
}

interface UnidadeCommunicationSettingsProps {
  initialConfig?: UnidadeCommunicationConfig | null
  onChange?: (config: UnidadeCommunicationConfig) => void
}

export function UnidadeCommunicationSettings({ initialConfig, onChange }: UnidadeCommunicationSettingsProps) {
  const dialog = useDialog()
  const [usarGlobal, setUsarGlobal] = useState<boolean>(initialConfig?.usar_global !== false)
  const [config, setConfig] = useState<UnidadeCommunicationConfig>({
    usar_global: initialConfig?.usar_global !== false,
    whatsapp_modo: initialConfig?.whatsapp_modo || 'api_astracall',
    whatsapp_astracall_url: initialConfig?.whatsapp_astracall_url || 'https://astracall.atb.app.br',
    whatsapp_astracall_sid: initialConfig?.whatsapp_astracall_sid || '',
    whatsapp_astracall_key: initialConfig?.whatsapp_astracall_key || '',
    email_smtp_habilitado: initialConfig?.email_smtp_habilitado || 'true',
    email_smtp_host: initialConfig?.email_smtp_host || '',
    email_smtp_porta: initialConfig?.email_smtp_porta || '587',
    email_smtp_usuario: initialConfig?.email_smtp_usuario || '',
    email_smtp_senha: initialConfig?.email_smtp_senha || '',
    email_smtp_remetente_email: initialConfig?.email_smtp_remetente_email || '',
    email_smtp_remetente_nome: initialConfig?.email_smtp_remetente_nome || ''
  })

  const [showWaApiKey, setShowWaApiKey] = useState(false)
  const [showSmtpPass, setShowSmtpPass] = useState(false)

  // Modais de Teste
  const [showWaTest, setShowWaTest] = useState(false)
  const [waPhone, setWaPhone] = useState('')
  const [waTesting, setWaTesting] = useState(false)
  const [waResult, setWaResult] = useState<any>(null)

  const [showEmailTest, setShowEmailTest] = useState(false)
  const [emailTo, setEmailTo] = useState('')
  const [emailTesting, setEmailTesting] = useState(false)
  const [emailResult, setEmailResult] = useState<any>(null)

  useEffect(() => {
    const updated = { ...config, usar_global: usarGlobal }
    if (onChange) onChange(updated)
  }, [usarGlobal, config])

  const updateField = (field: keyof UnidadeCommunicationConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }))
  }

  const handleRunWaTest = async () => {
    if (!waPhone) return void dialog.alert('Informe um número com DDD.')
    setWaTesting(true)
    setWaResult(null)
    try {
      const overrides: Record<string, any> = {
        whatsapp_modo: config.whatsapp_modo,
        whatsapp_astracall_url: config.whatsapp_astracall_url,
        whatsapp_astracall_sid: config.whatsapp_astracall_sid,
        whatsapp_astracall_key: config.whatsapp_astracall_key,
      }
      const res = await testWhatsAppConnectionAction(waPhone, overrides)
      setWaResult(res)
    } catch (err: any) {
      setWaResult({ success: false, error: err.message || 'Erro no teste' })
    } finally {
      setWaTesting(false)
    }
  }

  const handleRunEmailTest = async () => {
    if (!emailTo) return void dialog.alert('Informe um e-mail de destino.')
    setEmailTesting(true)
    setEmailResult(null)
    try {
      const res = await testEmailConnectionAction(emailTo)
      setEmailResult(res)
    } catch (err: any) {
      setEmailResult({ success: false, error: err.message || 'Erro no teste' })
    } finally {
      setEmailTesting(false)
    }
  }

  return (
    <div className="space-y-6 pt-4 border-t border-zinc-200 dark:border-zinc-800">
      {/* Campo oculto serializado para submissão via formulário nativo */}
      <input 
        type="hidden" 
        name="configuracoes_comunicacao" 
        value={JSON.stringify({ ...config, usar_global: usarGlobal })} 
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-50 dark:bg-purple-900/20 text-purple-600 rounded-xl">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-zinc-900 dark:text-white uppercase tracking-tight">Comunicação da Unidade (WhatsApp & E-mail)</h3>
            <p className="text-xs text-zinc-500">Escolha se esta unidade utiliza as configurações gerais do sistema ou possui canais próprios.</p>
          </div>
        </div>
      </div>

      {/* Seleção do Modo de Herança */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label 
          onClick={() => setUsarGlobal(true)}
          className={`flex items-start gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${
            usarGlobal 
              ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/20 shadow-sm' 
              : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-900'
          }`}
        >
          <input 
            type="radio" 
            name="modo_comunicacao_unidade" 
            checked={usarGlobal} 
            onChange={() => setUsarGlobal(true)} 
            className="mt-1 text-blue-600 focus:ring-blue-500"
          />
          <div className="space-y-1">
            <span className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight block">
              Usar Configuração Global (Padrão)
            </span>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Herda o canal oficial de WhatsApp e servidor SMTP configurados no menu geral do SisEscala.
            </p>
          </div>
        </label>

        <label 
          onClick={() => setUsarGlobal(false)}
          className={`flex items-start gap-4 p-5 rounded-2xl border-2 cursor-pointer transition-all ${
            !usarGlobal 
              ? 'border-purple-600 bg-purple-50/40 dark:bg-purple-950/20 shadow-sm' 
              : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 bg-white dark:bg-zinc-900'
          }`}
        >
          <input 
            type="radio" 
            name="modo_comunicacao_unidade" 
            checked={!usarGlobal} 
            onChange={() => setUsarGlobal(false)} 
            className="mt-1 text-purple-600 focus:ring-purple-500"
          />
          <div className="space-y-1">
            <span className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-tight block">
              Personalizar Comunicação para esta Unidade
            </span>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Cadastre uma conta/sessão de WhatsApp (ex: AstraCalls `inbox3_acc6`) ou SMTP próprios desta unidade.
            </p>
          </div>
        </label>
      </div>

      {/* PAINEL DE CONFIGURAÇÃO PRÓPRIA */}
      {!usarGlobal && (
        <div className="space-y-6 p-6 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-3xl animate-in fade-in duration-200">
          
          {/* SEÇÃO WHATSAPP DA UNIDADE */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-green-700 dark:text-green-400 uppercase tracking-wider">
                <MessageSquare className="h-4 w-4" /> WhatsApp Próprio da Unidade (AstraCalls / API)
              </div>
              <button
                type="button"
                onClick={() => setShowWaTest(true)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5"
              >
                <Send className="h-3 w-3" /> Testar WhatsApp da Unidade
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase">URL Base da API</label>
                <input 
                  type="text" 
                  className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-bold"
                  value={config.whatsapp_astracall_url || ''}
                  onChange={(e) => updateField('whatsapp_astracall_url', e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase">Sessão da Unidade (SID)</label>
                <input 
                  type="text" 
                  placeholder="ex: 779e6715... ou inbox3_acc6"
                  className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-bold"
                  value={config.whatsapp_astracall_sid || ''}
                  onChange={(e) => updateField('whatsapp_astracall_sid', e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase">Chave de API (X-API-Key)</label>
                <div className="relative">
                  <input 
                    type={showWaApiKey ? 'text' : 'password'}
                    placeholder="Chave do AstraCalls"
                    className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-bold pr-8"
                    value={config.whatsapp_astracall_key || ''}
                    onChange={(e) => updateField('whatsapp_astracall_key', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowWaApiKey(!showWaApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
                  >
                    {showWaApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* SEÇÃO SMTP DA UNIDADE */}
          <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                <Mail className="h-4 w-4" /> Servidor SMTP de E-mail da Unidade
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase">Host SMTP</label>
                <input 
                  type="text" 
                  placeholder="smtp.gmail.com"
                  className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-bold"
                  value={config.email_smtp_host || ''}
                  onChange={(e) => updateField('email_smtp_host', e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase">Usuário / E-mail SMTP</label>
                <input 
                  type="text" 
                  placeholder="unidade@maraba.pa.gov.br"
                  className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-bold"
                  value={config.email_smtp_usuario || ''}
                  onChange={(e) => updateField('email_smtp_usuario', e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase">Senha SMTP</label>
                <div className="relative">
                  <input 
                    type={showSmtpPass ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-bold pr-8"
                    value={config.email_smtp_senha || ''}
                    onChange={(e) => updateField('email_smtp_senha', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowSmtpPass(!showSmtpPass)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400"
                  >
                    {showSmtpPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL TESTE WA UNIDADE */}
      {showWaTest && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <span className="font-black text-xs uppercase tracking-tight">Testar WhatsApp da Unidade</span>
              <button onClick={() => setShowWaTest(false)}>✕</button>
            </div>
            <input 
              type="text" 
              placeholder="DDD + Telefone (ex: 94984396075)"
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-3 py-2 text-xs font-bold"
              value={waPhone}
              onChange={(e) => setWaPhone(e.target.value)}
            />
            <button 
              type="button"
              onClick={handleRunWaTest}
              disabled={waTesting}
              className="w-full py-2.5 bg-green-600 text-white font-black text-xs uppercase tracking-wider rounded-xl hover:bg-green-700 disabled:opacity-50"
            >
              {waTesting ? 'Enviando...' : 'Enviar Teste'}
            </button>
            {waResult && (
              <div className={`p-3 rounded-xl text-xs font-bold ${waResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {waResult.success ? '✓ Conexão com o WhatsApp da unidade validada!' : waResult.error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
