'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Clock, Monitor, Fingerprint, CheckCircle2, AlertTriangle, XCircle, Info, KeyRound } from 'lucide-react'
import type { ServidorPontoStatus } from './repStatusActions'

interface IndicadoresPontoServidorProps {
  status?: ServidorPontoStatus
  servidorNome: string
  matricula?: string | null
  unidadeNome?: string
  setorNome?: string
}

export function IndicadoresPontoServidor({
  status,
  servidorNome,
  matricula,
  unidadeNome,
  setorNome,
}: IndicadoresPontoServidorProps) {
  const [popoverAberto, setPopoverAberto] = useState<'rep' | 'terminal' | null>(null)
  const leaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleMouseEnter = (tipo: 'rep' | 'terminal') => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    setPopoverAberto(tipo)
  }

  const handleMouseLeave = () => {
    leaveTimerRef.current = setTimeout(() => {
      setPopoverAberto(null)
    }, 200)
  }

  // Fechar se clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setPopoverAberto(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Estilos do Relógio REP
  const situacaoRep = status?.rep?.situacao || 'fora_do_relogio'
  let repButtonClasses = ''
  let repIconColor = ''
  let repBadgeText = ''
  let repBadgeBg = ''

  switch (situacaoRep) {
    case 'pronto':
      repButtonClasses = 'text-emerald-700 dark:text-emerald-300 bg-emerald-100/90 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-200'
      repIconColor = 'text-emerald-600 dark:text-emerald-400'
      repBadgeText = 'Pronta para registrar ponto'
      repBadgeBg = 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
      break
    case 'sem_biometria':
      repButtonClasses = 'text-amber-700 dark:text-amber-300 bg-amber-100/90 dark:bg-amber-950/70 border-amber-300 dark:border-amber-700 hover:bg-amber-200'
      repIconColor = 'text-amber-600 dark:text-amber-400'
      repBadgeText = 'No relógio, mas FALTA biometria'
      repBadgeBg = 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
      break
    case 'sem_relogio_setor':
      repButtonClasses = 'text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200'
      repIconColor = 'text-zinc-500 dark:text-zinc-400'
      repBadgeText = 'Setor sem relógio físico'
      repBadgeBg = 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700'
      break
    case 'fora_do_relogio':
    default:
      repButtonClasses = 'text-rose-700 dark:text-rose-300 bg-rose-100/90 dark:bg-rose-950/70 border-rose-300 dark:border-rose-700 hover:bg-rose-200'
      repIconColor = 'text-rose-600 dark:text-rose-400'
      repBadgeText = 'Fora do relógio (não alocada)'
      repBadgeBg = 'bg-rose-100 dark:bg-rose-900/60 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700'
      break
  }

  // Estilos do Terminal de Computador
  const temPin = status?.terminal?.temPin ?? false
  let termButtonClasses = ''
  let termIconColor = ''
  let termBadgeText = ''
  let termBadgeBg = ''

  if (temPin) {
    termButtonClasses = 'text-emerald-700 dark:text-emerald-300 bg-emerald-100/90 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-200'
    termIconColor = 'text-emerald-600 dark:text-emerald-400'
    termBadgeText = 'Pronta para bater no terminal (PIN ativo)'
    termBadgeBg = 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
  } else {
    termButtonClasses = 'text-amber-700 dark:text-amber-300 bg-amber-100/90 dark:bg-amber-950/70 border-amber-300 dark:border-amber-700 hover:bg-amber-200'
    termIconColor = 'text-amber-600 dark:text-amber-400'
    termBadgeText = 'Pendente de PIN de acesso'
    termBadgeBg = 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700'
  }

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-1 shrink-0">
      {/* 1. BOTÃO RELÓGIO REP */}
      <button
        type="button"
        onMouseEnter={() => handleMouseEnter('rep')}
        onMouseLeave={handleMouseLeave}
        onClick={(e) => {
          e.stopPropagation()
          setPopoverAberto(curr => (curr === 'rep' ? null : 'rep'))
        }}
        aria-label="Status do Relógio de Ponto (REP)"
        className={`p-1 rounded border shadow-2xs transition-colors flex items-center justify-center cursor-pointer ${repButtonClasses}`}
      >
        <Clock className={`h-3.5 w-3.5 ${repIconColor}`} />
      </button>

      {/* 2. BOTÃO TERMINAL DE COMPUTADOR */}
      <button
        type="button"
        onMouseEnter={() => handleMouseEnter('terminal')}
        onMouseLeave={handleMouseLeave}
        onClick={(e) => {
          e.stopPropagation()
          setPopoverAberto(curr => (curr === 'terminal' ? null : 'terminal'))
        }}
        aria-label="Status do Terminal de Computador"
        className={`p-1 rounded border shadow-2xs transition-colors flex items-center justify-center cursor-pointer ${termButtonClasses}`}
      >
        <Monitor className={`h-3.5 w-3.5 ${termIconColor}`} />
      </button>

      {/* 3. BALÃO FLUTUANTE (POPOVER) */}
      {popoverAberto && (
        <div
          onMouseEnter={() => {
            if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
          }}
          onMouseLeave={handleMouseLeave}
          className="absolute left-0 top-full mt-1.5 z-50 w-72 sm:w-80 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl p-3 text-[11px] leading-relaxed text-zinc-800 dark:text-zinc-200 animate-in fade-in zoom-in-95 duration-150 text-left font-normal select-text"
        >
          {popoverAberto === 'rep' && (
            <div className="space-y-2.5">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                <div className="flex items-center gap-1.5 font-bold text-zinc-900 dark:text-white">
                  <Clock className={`h-4 w-4 ${repIconColor}`} />
                  <span>Relógio de Ponto (REP)</span>
                </div>
                {matricula && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    MAT {matricula}
                  </span>
                )}
              </div>

              {/* Nome do servidor */}
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate text-[11px]">
                {servidorNome}
              </div>

              {/* Status Badge */}
              <div className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1.5 ${repBadgeBg}`}>
                {situacaoRep === 'pronto' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                {situacaoRep === 'sem_biometria' && <Fingerprint className="h-3.5 w-3.5 shrink-0 animate-pulse" />}
                {situacaoRep === 'fora_do_relogio' && <XCircle className="h-3.5 w-3.5 shrink-0" />}
                {situacaoRep === 'sem_relogio_setor' && <Info className="h-3.5 w-3.5 shrink-0" />}
                <span>{repBadgeText}</span>
              </div>

              {/* Seção 1: Relógios Prontos com Biometria */}
              {status?.rep?.prontos && status.rep.prontos.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>Pronta para registrar ponto ({status.rep.prontos.length}):</span>
                  </div>
                  <ul className="space-y-1 pl-1">
                    {status.rep.prontos.map(d => (
                      <li key={d.id} className="flex items-center justify-between text-[10px] bg-emerald-50/60 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded border border-emerald-200/60 dark:border-emerald-900/50">
                        <span className="font-medium truncate max-w-[170px]">{d.nome}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {d.atendeSetor && (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold">
                              Deste Setor
                            </span>
                          )}
                          <span className="text-[8px] font-semibold text-emerald-700 dark:text-emerald-300">
                            Biometria OK
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Seção 2: Relógios com Biometria Faltando */}
              {status?.rep?.semBiometria && status.rep.semBiometria.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span>Cadastrada, mas FALTA biometria ({status.rep.semBiometria.length}):</span>
                  </div>
                  <ul className="space-y-1 pl-1">
                    {status.rep.semBiometria.map(d => (
                      <li key={d.id} className="flex items-center justify-between text-[10px] bg-amber-50/60 dark:bg-amber-950/30 px-1.5 py-0.5 rounded border border-amber-200/60 dark:border-amber-900/50">
                        <span className="font-medium truncate max-w-[170px]">{d.nome}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {d.atendeSetor && (
                            <span className="text-[8px] px-1 py-0.2 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold">
                              Deste Setor
                            </span>
                          )}
                          <span className="text-[8px] font-semibold text-amber-700 dark:text-amber-300">
                            Sem Digital
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[9px] text-amber-700 dark:text-amber-300 italic pt-0.5">
                    👉 Necessário cadastrar a digital presencialmente no equipamento.
                  </p>
                </div>
              )}

              {/* Seção 3: Não alocada em nenhum */}
              {(!status?.rep?.todosAlocados || status.rep.todosAlocados.length === 0) && (
                <div className="p-2 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-[10px] text-rose-800 dark:text-rose-300 space-y-1">
                  <p className="font-semibold flex items-center gap-1">
                    <XCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Não alocada em nenhum relógio</span>
                  </p>
                  <p className="text-[9px] leading-tight">
                    Este servidor não possui cadastro em nenhum relógio REP do parque. Use "Sincronizar cadastros" na aba Dispositivos REP.
                  </p>
                </div>
              )}

              {/* Seção 4: Relógio(s) deste Setor */}
              <div className="pt-1 border-t border-zinc-100 dark:border-zinc-800 text-[9px] text-zinc-500 dark:text-zinc-400">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">Relógios deste setor: </span>
                {status?.rep?.relogiosDoSetor?.length ? (
                  <span>{status.rep.relogiosDoSetor.map(r => r.nome).join(', ')}</span>
                ) : (
                  <span className="italic">Nenhum relógio físico vinculado a este setor.</span>
                )}
              </div>
            </div>
          )}

          {popoverAberto === 'terminal' && (
            <div className="space-y-2.5">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
                <div className="flex items-center gap-1.5 font-bold text-zinc-900 dark:text-white">
                  <Monitor className={`h-4 w-4 ${termIconColor}`} />
                  <span>Terminal de Computador</span>
                </div>
                {matricula && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    MAT {matricula}
                  </span>
                )}
              </div>

              {/* Nome do servidor */}
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 truncate text-[11px]">
                {servidorNome}
              </div>

              {/* Status Badge */}
              <div className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1.5 ${termBadgeBg}`}>
                {temPin ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5 shrink-0 animate-pulse" />
                )}
                <span>{termBadgeText}</span>
              </div>

              {/* Detalhes do PIN */}
              <div className="space-y-1 text-[10px]">
                <div className="font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                  <KeyRound className="h-3 w-3" />
                  <span>Autenticação de Ponto:</span>
                </div>
                {temPin ? (
                  <p className="text-zinc-600 dark:text-zinc-400 leading-snug">
                    ✅ <strong>PIN cadastrado e ativo.</strong> O servidor pode registrar presença normalmente digitando sua matrícula ({matricula || '—'}) e seu PIN no terminal.
                  </p>
                ) : (
                  <div className="p-1.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-[9px] space-y-0.5">
                    <p className="font-bold">⚠️ Sem PIN cadastrado</p>
                    <p>O servidor não definiu um PIN de acesso. Sem o PIN, o terminal recusará o registro de ponto.</p>
                  </div>
                )}
              </div>

              {/* Terminais vinculados */}
              <div className="space-y-1 pt-1 border-t border-zinc-100 dark:border-zinc-800 text-[9px]">
                <div className="font-bold text-zinc-700 dark:text-zinc-300">
                  Terminais desta unidade/setor:
                </div>
                {status?.terminal?.terminaisDoSetor && status.terminal.terminaisDoSetor.length > 0 ? (
                  <ul className="space-y-0.5 pl-1 text-zinc-600 dark:text-zinc-400">
                    {status.terminal.terminaisDoSetor.map(t => (
                      <li key={t.id} className="flex items-center gap-1">
                        <span className="h-1 w-1 rounded-full bg-emerald-500 shrink-0" />
                        <span className="font-medium">{t.nome}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-zinc-500 dark:text-zinc-400 italic">
                    Terminal padrão de presença (/presenca ou /presenca-local ativado pelo coordenador).
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
