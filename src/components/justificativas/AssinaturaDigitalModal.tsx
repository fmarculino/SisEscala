'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { 
  Sparkles, Key, Upload, Eye, EyeOff, Loader2, CheckCircle2, 
  AlertCircle, ShieldCheck, Copy, Check, FileCheck 
} from 'lucide-react'
import { validarCertificadoA1Action, assinarRelatorioPDFAction } from '@/app/(dashboard)/justificativas/sign-actions'

interface AssinaturaDigitalModalProps {
  isOpen: boolean
  onClose: () => void
  metadados: {
    servidorId?: string
    unidadeId?: string
    setorId?: string
    mes: number
    ano: number
    relatorioTipo: 'individual' | 'mensal'
    modoAssinatura: 'a1' | 'govbr' | 'manual' | 'mista'
    totalEventos: number
  }
  onSignatureSuccess: (signatureData: {
    hashSha256: string
    certInfo: any
  }) => void
}

export function AssinaturaDigitalModal({
  isOpen,
  onClose,
  metadados,
  onSignatureSuccess
}: AssinaturaDigitalModalProps) {
  const [pfxFile, setPfxFile] = useState<File | null>(null)
  const [pfxBase64, setPfxBase64] = useState<string>('')
  const [passphrase, setPassphrase] = useState<string>('')
  const [showPass, setShowPass] = useState(false)
  
  const [validating, setValidating] = useState(false)
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [certInfo, setCertInfo] = useState<any | null>(null)
  const [signatureResult, setSignatureResult] = useState<any | null>(null)
  const [copiedHash, setCopiedHash] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.match(/\.(pfx|p12)$/i)) {
      setError('Por favor, selecione um arquivo de certificado com extensão .pfx ou .p12.')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('O arquivo de certificado deve ter no máximo 5MB.')
      return
    }

    setError(null)
    setPfxFile(file)
    setCertInfo(null)
    setSignatureResult(null)

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1] || result
      setPfxBase64(base64)
    }
    reader.readAsDataURL(file)
  }

  const handleValidarCertificado = async () => {
    if (!pfxBase64) {
      setError('Selecione o arquivo do certificado digital .pfx ou .p12.')
      return
    }
    if (!passphrase) {
      setError('Informe a senha do certificado digital.')
      return
    }

    setError(null)
    setValidating(true)

    try {
      const res = await validarCertificadoA1Action(pfxBase64, passphrase)
      if (res.error) {
        setError(res.error)
        setCertInfo(null)
      } else if (res.certInfo) {
        setCertInfo(res.certInfo)
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao validar certificado.')
    } finally {
      setValidating(false)
    }
  }

  const handleAssinar = async () => {
    if (!pfxBase64 || !passphrase || !certInfo) {
      setError('Por favor, valide o certificado digital antes de assinar.')
      return
    }

    setError(null)
    setSigning(true)

    try {
      const res = await assinarRelatorioPDFAction({
        pfxBase64,
        passphrase,
        metadados
      })

      if (res.error) {
        setError(res.error)
      } else if (res.success) {
        setSignatureResult(res)
        onSignatureSuccess({
          hashSha256: res.hashSha256!,
          certInfo: res.certInfo
        })
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao efetuar assinatura digital.')
    } finally {
      setSigning(false)
    }
  }

  const handleCopyHash = () => {
    if (signatureResult?.hashSha256) {
      navigator.clipboard.writeText(signatureResult.hashSha256)
      setCopiedHash(true)
      setTimeout(() => setCopiedHash(false), 2000)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assinatura Digital com Certificado A1">
      <div className="space-y-6">
        {/* Banner de Segurança */}
        <div className="p-4 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/60 rounded-2xl flex items-start gap-3">
          <ShieldCheck className="h-6 w-6 text-purple-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs text-purple-900 dark:text-purple-300">
            <h4 className="font-bold">Assinatura Criptográfica em Memória (Sem Armazenamento)</h4>
            <p className="leading-relaxed text-[11px]">
              Seu arquivo de certificado e senha são processados estritamente na memória do servidor para gerar a assinatura digital PKCS#7 e descartados imediatamente. Nenhuma chave privada é armazenada.
            </p>
          </div>
        </div>

        {signatureResult ? (
          /* RESULTADO DE SUCESSO DA ASSINATURA */
          <div className="space-y-6 animate-in fade-in zoom-in duration-200">
            <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-3xl text-center space-y-4">
              <div className="p-3 bg-emerald-600 text-white rounded-2xl w-fit mx-auto shadow-lg shadow-emerald-600/30">
                <FileCheck className="h-8 w-8" />
              </div>
              <div>
                <h3 className="font-black text-emerald-900 dark:text-emerald-200 text-lg uppercase tracking-tight">
                  Relatório Assinado com Sucesso!
                </h3>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  Assinatura digital avançada A1 inserida e autenticada.
                </p>
              </div>

              {/* Card com Metadados */}
              <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/40 text-left text-xs space-y-2 font-mono">
                <div className="flex justify-between">
                  <span className="text-zinc-400 font-sans">Titular:</span>
                  <span className="font-bold text-zinc-900 dark:text-white truncate max-w-[200px]">{signatureResult.certInfo?.cn}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400 font-sans">Emissor:</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{signatureResult.certInfo?.issuer}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400 font-sans">Data da Assinatura:</span>
                  <span className="text-zinc-700 dark:text-zinc-300">{new Date(signatureResult.certInfo?.assinadoEm).toLocaleString('pt-BR')}</span>
                </div>
              </div>

              {/* Hash SHA-256 */}
              <div className="p-3 bg-white dark:bg-zinc-900 rounded-xl border border-emerald-200 dark:border-emerald-900/40 flex items-center justify-between gap-2 text-xs">
                <div className="text-left font-mono truncate">
                  <span className="text-[10px] font-sans font-bold text-zinc-400 uppercase block">Hash SHA-256 de Integridade:</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-300 text-[11px]">{signatureResult.hashSha256}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyHash}
                  className="p-2 bg-emerald-100 dark:bg-emerald-900/50 hover:bg-emerald-200 text-emerald-700 dark:text-emerald-300 rounded-lg shrink-0 transition-all"
                  title="Copiar Hash"
                >
                  {copiedHash ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-emerald-600/20 transition-all"
              >
                Concluir & Visualizar Relatório
              </button>
            </div>
          </div>
        ) : (
          /* FORMULÁRIO DE SELEÇÃO DE CERTIFICADO E SENHA */
          <div className="space-y-5">
            {/* Input File PFX */}
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
                Arquivo do Certificado Digital A1 (.pfx / .p12) <span className="text-red-500">*</span>
              </label>
              <div className="relative border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-2xl p-4 text-center hover:border-purple-500 transition-colors bg-zinc-50 dark:bg-zinc-800/40">
                <input
                  type="file"
                  accept=".pfx,.p12"
                  onChange={handleFileChange}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
                <div className="space-y-1">
                  <Upload className="h-6 w-6 text-purple-500 mx-auto" />
                  <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    {pfxFile ? pfxFile.name : 'Clique para selecionar o arquivo .pfx ou .p12'}
                  </p>
                  <p className="text-[11px] text-zinc-400">Tamanho máximo: 5MB</p>
                </div>
              </div>
            </div>

            {/* Input Passphrase */}
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wider text-zinc-500 block">
                Senha / PIN do Certificado <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400">
                  <Key className="h-4 w-4" />
                </div>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Digite a senha do certificado..."
                  className="w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl pl-10 pr-10 py-3 text-sm font-bold focus:ring-2 focus:ring-purple-500 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-zinc-400 hover:text-zinc-600"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Preview do Certificado Validado */}
            {certInfo && (
              <div className="p-4 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900/40 rounded-2xl space-y-2 text-xs font-medium animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="font-black text-purple-900 dark:text-purple-300 uppercase tracking-wider text-[11px]">
                    Certificado Validadas com Sucesso
                  </span>
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold text-[10px]">
                    VÁLIDO
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1 text-zinc-700 dark:text-zinc-300">
                  <div><strong>Titular:</strong> {certInfo.cn}</div>
                  <div><strong>Emissor:</strong> {certInfo.issuer}</div>
                  <div><strong>Válido até:</strong> {new Date(certInfo.validTo).toLocaleDateString('pt-BR')}</div>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl text-red-700 dark:text-red-300 text-xs font-bold flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
              >
                Cancelar
              </button>

              {!certInfo ? (
                <button
                  type="button"
                  onClick={handleValidarCertificado}
                  disabled={validating || !pfxFile || !passphrase}
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-purple-600/20 flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
                  {validating ? 'Validando...' : 'Validar Certificado'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleAssinar}
                  disabled={signing}
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-lg shadow-purple-600/20 flex items-center gap-2 transition-all"
                >
                  {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {signing ? 'Assinando PDF...' : 'Assinar Relatório Agora'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
