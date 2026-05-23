'use client'

import React, { useState } from 'react'
import packageJson from '../../../../package.json'
import { 
  BookOpen, 
  HelpCircle, 
  Shield, 
  Table, 
  Clock, 
  MapPin, 
  CheckCircle2, 
  AlertTriangle, 
  MessageSquare, 
  Settings,
  ChevronRight,
  Search,
  Zap,
  Info
} from 'lucide-react'

type DocSection = {
  id: string
  title: string
  icon: any
  content: React.ReactNode
}

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState('visao-geral')
  const [searchQuery, setSearchQuery] = useState('')

  const sections: DocSection[] = [
    {
      id: 'visao-geral',
      title: 'Visão Geral',
      icon: Info,
      content: (
        <div className="space-y-6">
          <section>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">O que é o SisEscala?</h2>
            <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
              O SisEscala é uma plataforma avançada de governança e gestão de escalas hospitalares. 
              Diferente de uma planilha comum, ele integra a elaboração da escala com a auditoria em tempo real, 
              garantindo que o que foi planejado seja efetivamente cumprido e validado.
            </p>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 bg-blue-50/50 dark:bg-blue-900/10">
              <h3 className="font-bold text-blue-900 dark:text-blue-100 flex items-center gap-2 mb-2">
                <Shield className="h-4 w-4" /> Governança
              </h3>
              <p className="text-xs text-blue-800/80 dark:text-blue-300/80">
                Regras automáticas de presença, validação por GPS e bloqueio de conflitos entre unidades.
              </p>
            </div>
            <div className="p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/50 dark:bg-emerald-900/10">
              <h3 className="font-bold text-emerald-900 dark:text-emerald-100 flex items-center gap-2 mb-2">
                <Table className="h-4 w-4" /> Transparência
              </h3>
              <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                Visualização clara entre "Planejado" (previsão) e "Validado" (realidade para pagamento).
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'gestao-escalas',
      title: 'Gestão de Escalas',
      icon: Table,
      content: (
        <div className="space-y-6">
          <section>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">A Grade de Escala</h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              A grade funciona como uma planilha inteligente de alta densidade. Cada servidor possui 4 linhas de lançamento:
            </p>
            <ul className="space-y-3">
              <li className="flex gap-3">
                <span className="font-bold text-blue-600 min-w-[80px]">REGULAR:</span>
                <span className="text-zinc-600 dark:text-zinc-400 text-sm">Carga horária padrão definida pela Jornada de Trabalho selecionada.</span>
              </li>
              <li className="flex gap-3">
                <span className="font-bold text-indigo-600 min-w-[80px]">EXTRAS:</span>
                <span className="text-zinc-600 dark:text-zinc-400 text-sm">Horas adicionais (100% ou 50%) fora da jornada padrão.</span>
              </li>
              <li className="flex gap-3">
                <span className="font-bold text-orange-600 min-w-[80px]">PLANTÃO:</span>
                <span className="text-zinc-600 dark:text-zinc-400 text-sm">Plantões de 12h, 6h ou 4h, geralmente pagos de forma avulsa.</span>
              </li>
              <li className="flex gap-3">
                <span className="font-bold text-emerald-600 min-w-[80px]">SOBREAVISO:</span>
                <span className="text-zinc-600 dark:text-zinc-400 text-sm">Período de prontidão integral (12h). Contabilizado mesmo sem acionamento, salvo se houver falha.</span>
              </li>
            </ul>
          </section>

          <div className="bg-amber-50 dark:bg-amber-900/10 border-l-4 border-amber-400 p-4">
            <h4 className="font-bold text-amber-900 dark:text-amber-100 flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4" /> Importante: Salvar vs Fechar
            </h4>
            <p className="text-xs text-amber-800 dark:text-amber-200">
              <strong>Salvar Previsão:</strong> Grava as alterações mas permite continuar editando.<br/>
              <strong>Fechar Escala:</strong> Finaliza a edição manual. A partir daqui, as horas começam a ser validadas pelo ponto eletrônico e apenas acionamentos de sobreaviso são permitidos.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'presenca-gps',
      title: 'Presença e GPS',
      icon: MapPin,
      content: (
        <div className="space-y-6">
          <section>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">Validação por Geolocalização</h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              Para garantir que o servidor está fisicamente na unidade, o sistema utiliza o GPS do dispositivo no momento do registro.
            </p>
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                <div className="bg-blue-100 dark:bg-blue-900 p-2 rounded-full">
                  <MapPin className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">Raio de Tolerância</h4>
                  <p className="text-xs text-zinc-500">O servidor deve estar dentro do raio definido nas configurações da unidade (padrão: 50m) para que o ponto seja validado automaticamente.</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                <div className="bg-emerald-100 dark:bg-emerald-900 p-2 rounded-full">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">Validação Manual</h4>
                  <p className="text-xs text-zinc-500">Administradores e Coordenadores podem validar presenças manualmente caso haja falha técnica comprovada, sendo registrado quem realizou a validação para fins de auditoria.</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )
    },
    {
      id: 'sobreaviso',
      title: 'Sobreaviso',
      icon: Zap,
      content: (
        <div className="space-y-6">
          <section>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">Fluxo de Acionamento</h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              O Sobreaviso é um regime de prontidão. Quando um servidor precisa ser convocado para o trabalho efetivo, o fluxo segue estes passos:
            </p>
            <ol className="space-y-4">
              <li className="flex gap-4 items-center">
                <div className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold">1</div>
                <div className="text-sm">O administrador clica no <strong>Status</strong> do sobreaviso na grade.</div>
              </li>
              <li className="flex gap-4 items-center">
                <div className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold">2</div>
                <div className="text-sm">Informa o motivo e gera um <strong>Link Mágico</strong>.</div>
              </li>
              <li className="flex gap-4 items-center">
                <div className="h-6 w-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold">3</div>
                <div className="text-sm">Envia o link via <strong>WhatsApp</strong> para o servidor.</div>
              </li>
              <li className="flex gap-4 items-center border-l-2 border-blue-500 pl-4 ml-3 py-1">
                <div className="text-sm font-medium text-blue-600 dark:text-blue-400 italic">
                  "O servidor tem um tempo limite para aceitar o chamado. Caso não o faça, o sistema marca o período como 'Falhou' e as horas são descontadas."
                </div>
              </li>
            </ol>
          </section>
        </div>
      )
    },
    {
      id: 'configuracoes',
      title: 'Configurações',
      icon: Settings,
      content: (
        <div className="space-y-6">
          <section>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">Governança Global</h2>
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              As configurações definem o "rigor" do sistema em toda a unidade.
            </p>
            <div className="space-y-3">
              <div className="p-3 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <h4 className="text-sm font-bold">Exigir Confirmação de Presença</h4>
                <p className="text-xs text-zinc-500">Se ativo, o sistema ignora horas regulares que não possuam registro de entrada/saída válidos.</p>
              </div>
              <div className="p-3 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <h4 className="text-sm font-bold">Desconsiderar Falhas no Sobreaviso</h4>
                <p className="text-xs text-zinc-500">Define se uma convocação não atendida deve ou não zerar as 12h de prontidão do servidor.</p>
              </div>
            </div>
          </section>
        </div>
      )
    }
  ]

  const filteredSections = sections.filter(s => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.id.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] overflow-hidden bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
      {/* Header */}
      <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-50/50 dark:bg-zinc-900/50">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-blue-600" /> Central de Ajuda SisEscala
          </h1>
          <p className="text-sm text-zinc-500">Documentação técnica e guias operacionais do sistema</p>
        </div>
        
        <div className="relative max-w-md w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input 
            type="text" 
            placeholder="Pesquisar tópico..."
            className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 overflow-y-auto p-4 space-y-2 bg-zinc-50/30 dark:bg-zinc-900/20">
          <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-4 px-2">Categorias</div>
          {filteredSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeSection === section.id 
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' 
                : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <section.icon className={`h-4 w-4 ${activeSection === section.id ? 'text-white' : 'text-zinc-400'}`} />
              {section.title}
              {activeSection === section.id && <ChevronRight className="h-3 w-3 ml-auto opacity-50" />}
            </button>
          ))}
          
          <div className="mt-8 pt-8 border-t border-zinc-200 dark:border-zinc-800">
            <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white">
              <HelpCircle className="h-5 w-5 mb-2 opacity-80" />
              <p className="text-[10px] font-bold uppercase opacity-80">Suporte Técnico</p>
              <p className="text-xs mt-1 leading-relaxed">Em caso de dúvidas críticas, entre em contato com o administrador do sistema.</p>
            </div>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-8 md:p-12 scroll-smooth">
          <div className="max-w-3xl mx-auto">
            {sections.find(s => s.id === activeSection)?.content}
            
            <div className="mt-12 pt-8 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
              <p>Ultima atualização: Maio de 2026</p>
              <div className="flex items-center gap-4">
                <button className="hover:text-blue-600 transition-colors">Esta página foi útil?</button>
                <span>|</span>
                <p>Versão v{packageJson.version}</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
