'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Camera, RefreshCw, Check, Upload, X, AlertCircle, Image as ImageIcon } from 'lucide-react'

interface WebcamPhotoCaptureModalProps {
  isOpen: boolean
  onClose: () => void
  onPhotoCaptured: (dataUrl: string) => void
  currentPhotoUrl?: string | null
}

export function WebcamPhotoCaptureModal({
  isOpen,
  onClose,
  onPhotoCaptured,
  currentPhotoUrl
}: WebcamPhotoCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [stream, setStream] = useState<MediaStream | null>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(false)

  // Stop camera tracks
  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
      setStream(null)
    }
  }, [stream])

  // Start camera stream
  const startCamera = useCallback(async () => {
    setCameraError(null)
    setIsInitializing(true)
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('A API de câmera não é suportada por este navegador.')
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: false
      })

      setStream(mediaStream)
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream
      }
    } catch (err: any) {
      console.error('Erro ao acessar webcam:', err)
      let msg = 'Não foi possível acessar a câmera do computador.'
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Permissão de acesso à câmera negada. Verifique as configurações do seu navegador.'
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'Nenhuma câmera foi encontrada neste dispositivo.'
      }
      setCameraError(msg)
    } finally {
      setIsInitializing(false)
    }
  }, [])

  // Handle modal open/close
  useEffect(() => {
    if (isOpen) {
      setCapturedPhoto(null)
      startCamera()
    } else {
      stopCamera()
    }
    return () => {
      stopCamera()
    }
  }, [isOpen])

  // Bind video element when stream is ready
  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  // Capture photo from video frame
  const takeSnapshot = () => {
    if (!videoRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current || document.createElement('canvas')
    
    // Set 1:1 square aspect ratio crop for profile photo
    const size = Math.min(video.videoWidth || 640, video.videoHeight || 480)
    canvas.width = 400
    canvas.height = 400
    
    const ctx = canvas.getContext('2d')
    if (ctx) {
      const startX = (video.videoWidth - size) / 2
      const startY = (video.videoHeight - size) / 2
      
      // Draw centered cropped frame
      ctx.drawImage(video, startX, startY, size, size, 0, 0, 400, 400)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
      setCapturedPhoto(dataUrl)
    }
  }

  // Handle File Upload Fallback
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecione um arquivo de imagem válido.')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 400
        canvas.height = 400
        const ctx = canvas.getContext('2d')
        if (ctx) {
          const size = Math.min(img.width, img.height)
          const startX = (img.width - size) / 2
          const startY = (img.height - size) / 2
          ctx.drawImage(img, startX, startY, size, size, 0, 0, 400, 400)
          setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.88))
        }
      }
      img.src = event.target?.result as string
    }
    reader.readAsDataURL(file)
  }

  const handleConfirm = () => {
    if (capturedPhoto) {
      onPhotoCaptured(capturedPhoto)
      stopCamera()
      onClose()
    }
  }

  const handleRetake = () => {
    setCapturedPhoto(null)
    if (!stream) {
      startCamera()
    } else if (videoRef.current) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(() => {})
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { stopCamera(); onClose(); }}
      title="Fotografar Servidor via Webcam"
    >
      <div className="space-y-4">
        {/* Hidden Canvas for capture */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          className="hidden"
          onChange={handleFileUpload}
        />

        {/* Video / Snapshot Display */}
        <div className="relative aspect-square w-full max-w-sm mx-auto bg-black rounded-2xl overflow-hidden shadow-inner flex items-center justify-center border-2 border-zinc-200 dark:border-zinc-800">
          {/* Always rendered video element to preserve stream reference */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover transform -scale-x-100 ${capturedPhoto || !stream ? 'hidden' : 'block'}`}
          />

          {/* Profile Framing Guide Overlay */}
          {stream && !capturedPhoto && (
            <>
              <div className="absolute inset-0 border-[3px] border-emerald-500/60 rounded-full m-8 pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
              <div className="absolute top-3 left-0 right-0 text-center pointer-events-none">
                <span className="bg-black/60 text-white text-[11px] font-bold px-3 py-1 rounded-full backdrop-blur-sm">
                  Posicione o rosto dentro do círculo
                </span>
              </div>
            </>
          )}

          {/* Captured Snapshot Display */}
          {capturedPhoto && (
            <img
              src={capturedPhoto}
              alt="Foto capturada"
              className="w-full h-full object-cover animate-in zoom-in-95 duration-200"
            />
          )}

          {/* Camera Error Display */}
          {!stream && cameraError && (
            <div className="p-6 text-center text-zinc-400 space-y-3">
              <AlertCircle className="h-10 w-10 text-amber-500 mx-auto" />
              <p className="text-xs font-semibold text-zinc-300">{cameraError}</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all inline-flex items-center gap-2"
              >
                <Upload className="h-4 w-4" />
                Carregar Imagem do Computador
              </button>
            </div>
          )}

          {/* Camera Loading Display */}
          {!stream && !cameraError && (
            <div className="text-center text-zinc-400 p-6">
              <Camera className="h-10 w-10 animate-bounce text-zinc-500 mx-auto mb-2" />
              <p className="text-xs font-semibold">Iniciando câmera...</p>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          {capturedPhoto ? (
            <>
              <button
                type="button"
                onClick={handleRetake}
                className="w-full sm:w-auto px-4 py-2.5 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Tirar Outra Foto
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
              >
                <Check className="h-4 w-4" />
                Confirmar & Usar Foto
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full sm:w-auto px-4 py-2 text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 flex items-center justify-center gap-1.5"
              >
                <Upload className="h-4 w-4" />
                Carregar do disco
              </button>

              <button
                type="button"
                disabled={!stream}
                onClick={takeSnapshot}
                className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Camera className="h-4 w-4" />
                Capturar Foto
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
