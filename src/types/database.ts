export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string | null
          role: 'super_admin' | 'admin' | 'coordenador' | 'servidor' | 'comum'
          unidade_id: string | null
          setor_id: string | null
          acesso_todas_unidades: boolean
          acesso_todos_setores: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string | null
          role?: 'super_admin' | 'admin' | 'coordenador' | 'servidor' | 'comum'
          unidade_id?: string | null
          setor_id?: string | null
          acesso_todas_unidades?: boolean
          acesso_todos_setores?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          role?: 'super_admin' | 'admin' | 'coordenador' | 'servidor' | 'comum'
          unidade_id?: string | null
          setor_id?: string | null
          acesso_todas_unidades?: boolean
          acesso_todos_setores?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      profile_unidades: {
        Row: {
          profile_id: string
          unidade_id: string
        }
        Insert: {
          profile_id: string
          unidade_id: string
        }
        Update: {
          profile_id?: string
          unidade_id?: string
        }
      }
      profile_setores: {
        Row: {
          profile_id: string
          setor_id: string
        }
        Insert: {
          profile_id: string
          setor_id: string
        }
        Update: {
          profile_id?: string
          setor_id?: string
        }
      }
      unidades: {
        Row: {
          id: string
          nome: string
          endereco: string | null
          ativo: boolean
        }
      }
      setores: {
        Row: {
          id: string
          unidade_id: string | null
          nome: string
          ativo: boolean
        }
      }
      servidores: {
        Row: {
          id: string
          nome: string
          matricula: string | null
          unidade_id: string | null
          setor_id: string | null
        }
      }
      escala_mensal: {
        Row: {
          id: string
          mes: number
          ano: number
          unidade_id: string | null
          setor_id: string | null
          servidor_id: string | null
          status: string
        }
      }
      tipos_eventos: {
        Row: {
          id: string
          nome: string
          cor: string
          descricao: string | null
          ativo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nome: string
          cor?: string
          descricao?: string | null
          ativo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          nome?: string
          cor?: string
          descricao?: string | null
          ativo?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      servidores_eventos: {
        Row: {
          id: string
          servidor_id: string
          tipo_evento_id: string
          data_inicio: string
          data_fim: string
          observacao: string | null
          criado_por: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          servidor_id: string
          tipo_evento_id: string
          data_inicio: string
          data_fim: string
          observacao?: string | null
          criado_por?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          servidor_id?: string
          tipo_evento_id?: string
          data_inicio?: string
          data_fim?: string
          observacao?: string | null
          criado_por?: string | null
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}

