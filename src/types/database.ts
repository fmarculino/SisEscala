// Tipos derivados do schema do Supabase
// Gerados em 2026-05-06

export type VinculoType = 'Contratada' | 'Concursada' | 'Efetiva' | 'Comissionada'
export type TurnoTipo = 'Normal' | 'Plantão' | 'Sobreaviso' | 'Extra'
export type EscalaCategoria = 'Regular' | 'Extra' | 'Plantão' | 'Sobreaviso'
export type SobreavisoStatus = 'Aguardando' | 'Aceito' | 'Chegou' | 'Falhou' | 'Recusado' | 'Expirado'
export type UserRole = 'super_admin' | 'coordenador' | 'servidor'

export interface Unidade {
  id: string
  nome: string
  endereco: string | null
  latitude: number | null
  longitude: number | null
  raio_geofence: number | null
  created_at: string | null
  updated_at: string | null
}

export interface Servidor {
  id: string
  nome: string
  matricula: string | null
  cargo: string | null
  vinculo: VinculoType
  unidade_id: string | null
  setor_id: string | null
  created_at: string | null
  updated_at: string | null
}

export interface Setor {
  id: string
  nome: string
  unidade_id: string | null
  parent_id: string | null
  created_at: string | null
  updated_at: string | null
}

export interface DicionarioTurno {
  id: string
  codigo: string
  descricao: string | null
  horas_computadas: number
  tipo: TurnoTipo
  created_at: string | null
  updated_at: string | null
}

export interface EscalaMensal {
  id: string
  mes: number
  ano: number
  servidor_id: string | null
  unidade_id: string | null
  setor_id: string | null
  status: string
  created_at: string | null
  updated_at: string | null
}

export interface EscalaDiaria {
  id: string
  escala_mensal_id: string | null
  dia: number
  dicionario_turnos_id: string | null
  categoria: EscalaCategoria | null
  created_at: string | null
  updated_at: string | null
}

export interface LogSobreaviso {
  id: string
  servidor_id: string | null
  unidade_id: string | null
  escala_mensal_id: string | null
  dia: number | null
  data_hora_acionamento: string | null
  status: SobreavisoStatus
  token_magic_link: string | null
  data_hora_aceite: string | null
  ip_aceite: string | null
  user_agent: string | null
  lat_aceite: number | null
  long_aceite: number | null
  eta_minutos: number | null
  data_hora_chegada: string | null
  tipo_validacao_chegada: string | null
  lat_chegada: number | null
  long_chegada: number | null
  motivo_acionamento: string | null
  justificativa_recusa: string | null
  lat_recusa: number | null
  long_recusa: number | null
  motivo_falha: string | null
  validacao_manual: boolean | null
  created_at: string | null
}

export interface Profile {
  id: string
  full_name: string | null
  role: UserRole
  unidade_id: string | null
  created_at: string | null
  updated_at: string | null
}
