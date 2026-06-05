'use client'

import { useState } from 'react'

interface LogoUploadManagerProps {
  initialLogoUrl?: string | null
  name?: string
  id?: string
  recommendationText?: string
}

export function LogoUploadManager({
  initialLogoUrl,
  name = 'logo',
  id = 'logo',
  recommendationText = 'Recomendado: PNG com fundo transparente. Resolução máxima sugerida: 400x120px (máx. 1MB).'
}: LogoUploadManagerProps) {
  const [removed, setRemoved] = useState(false)
  const hasLogo = initialLogoUrl && !removed

  return (
    <div className="space-y-4">
      {hasLogo && (
        <div className="mt-2 mb-3 flex items-center gap-4 animate-in fade-in">
          <div className="h-16 w-32 border border-zinc-200 dark:border-zinc-700 rounded-[1rem] overflow-hidden bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] dark:bg-[radial-gradient(#3f3f46_1px,transparent_1px)] bg-[size:10px_10px] bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center p-2 shadow-inner">
            <img 
              src={initialLogoUrl} 
              alt="Logo atual" 
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <button
            type="button"
            onClick={() => setRemoved(true)}
            className="px-4 py-2 text-xs font-black text-red-600 bg-red-50 dark:bg-red-950/30 rounded-xl hover:bg-red-100 dark:hover:bg-red-950/50 transition-all uppercase tracking-wider"
          >
            Remover Imagem
          </button>
        </div>
      )}

      {!hasLogo && (
        <div className="relative group animate-in fade-in duration-200">
          <input
            id={id}
            name={name}
            type="file"
            accept="image/png, image/jpeg, image/svg+xml"
            className="block w-full text-sm text-zinc-500 file:mr-4 file:py-3 file:px-6 file:rounded-2xl file:border-2 file:border-dashed file:border-zinc-200 dark:file:border-zinc-700 file:text-sm file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-zinc-800 dark:file:text-zinc-300 file:transition-all cursor-pointer"
          />
        </div>
      )}
      
      {!hasLogo && recommendationText && (
        <p className="mt-1 text-[10px] text-zinc-500 font-bold uppercase tracking-tight">
          {recommendationText}
        </p>
      )}

      <input 
        type="hidden" 
        name="remove_logo" 
        value={removed ? 'true' : 'false'} 
      />
    </div>
  )
}
