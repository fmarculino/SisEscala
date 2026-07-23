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
          servidores_manha_min: number | null
          servidores_manha_ideal: number | null
          servidores_manha_max: number | null
          servidores_tarde_min: number | null
          servidores_tarde_ideal: number | null
          servidores_tarde_max: number | null
          servidores_noite_min: number | null
          servidores_noite_ideal: number | null
          servidores_noite_max: number | null
          dimensionamento_fds_feriados: boolean | null
          latitude: number | null
          longitude: number | null
          raio_geofence: number | null
        }
      }
      servidores: {
        Row: {
          id: string
          nome: string
          matricula: string | null
          cpf: string | null
          cargo: string | null
          vinculo: string | null
          unidade_id: string | null
          setor_id: string | null
          email: string | null
          telefone: string | null
          pin_acesso: string | null
          ignora_janela_presenca?: boolean | null
          preferenca_turno: 'M' | 'T' | 'N' | 'Flexivel' | null
          carga_horaria_semanal: number | null
          status?: string | null
          motivo_inativacao?: string | null
          data_nascimento?: string | null
          sexo?: string | null
          nacionalidade?: string | null
          naturalidade?: string | null
          nome_mae?: string | null
          nome_pai?: string | null
          escolaridade?: string | null
          estado_civil?: string | null
          nome_conjuge?: string | null
          endereco_logradouro?: string | null
          endereco_numero?: string | null
          bairro?: string | null
          cep?: string | null
          municipio_residencia?: string | null
          telefone_residencial?: string | null
          rg_numero?: string | null
          rg_orgao_emissor?: string | null
          rg_data_emissao?: string | null
          pis_pasep?: string | null
          registro_profissional?: string | null
          registro_profissional_orgao?: string | null
          data_admissao_hmm?: string | null
          data_admissao_pmm?: string | null
          observacao?: string | null
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
      historico_transferencias: {
        Row: {
          id: string
          servidor_id: string
          unidade_origem_id: string | null
          setor_origem_id: string | null
          unidade_destino_id: string | null
          setor_destino_id: string | null
          data_transferencia: string
          motivo: string
          criado_por_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          servidor_id: string
          unidade_origem_id?: string | null
          setor_origem_id?: string | null
          unidade_destino_id?: string | null
          setor_destino_id?: string | null
          data_transferencia: string
          motivo: string
          criado_por_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          servidor_id?: string
          unidade_origem_id?: string | null
          setor_origem_id?: string | null
          unidade_destino_id?: string | null
          setor_destino_id?: string | null
          data_transferencia?: string
          motivo?: string
          criado_por_id?: string | null
          created_at?: string
        }
      }
      solicitacoes_ferias_licencas: {
        Row: {
          id: string
          servidor_id: string
          unidade_id: string | null
          setor_id: string | null
          tipo_beneficio: 'ferias' | 'licenca_premio'
          exercicio: string
          modalidade: 'integral_30' | 'fracionado_15_15' | 'abono_10_20' | 'integral_90' | 'fracionado_45_45'
          sugestao_fracionamento: Json | null
          opcoes_datas: Json
          status: 'aguardando_validacao' | 'deferido' | 'indeferido' | 'contraproposta' | 'cancelado'
          opcao_selecionada: number | null
          periodo_deferido_p1_inicio: string | null
          periodo_deferido_p1_fim: string | null
          periodo_deferido_p2_inicio: string | null
          periodo_deferido_p2_fim: string | null
          abono_pecuniario: boolean
          adicional_terco: boolean
          observacao_servidor: string | null
          parecer_coordenador: string | null
          contraproposta_datas: Json | null
          validado_por: string | null
          validado_em: string | null
          eventos_gerados_ids: string[] | null
          cancelado_por: string | null
          cancelado_em: string | null
          motivo_cancelamento: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          servidor_id: string
          unidade_id?: string | null
          setor_id?: string | null
          tipo_beneficio: 'ferias' | 'licenca_premio'
          exercicio: string
          modalidade: 'integral_30' | 'fracionado_15_15' | 'abono_10_20' | 'integral_90' | 'fracionado_45_45'
          sugestao_fracionamento?: Json | null
          opcoes_datas: Json
          status?: 'aguardando_validacao' | 'deferido' | 'indeferido' | 'contraproposta' | 'cancelado'
          opcao_selecionada?: number | null
          periodo_deferido_p1_inicio?: string | null
          periodo_deferido_p1_fim?: string | null
          periodo_deferido_p2_inicio?: string | null
          periodo_deferido_p2_fim?: string | null
          abono_pecuniario?: boolean
          adicional_terco?: boolean
          observacao_servidor?: string | null
          parecer_coordenador?: string | null
          contraproposta_datas?: Json | null
          validado_por?: string | null
          validado_em?: string | null
          eventos_gerados_ids?: string[] | null
          cancelado_por?: string | null
          cancelado_em?: string | null
          motivo_cancelamento?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          servidor_id?: string
          unidade_id?: string | null
          setor_id?: string | null
          tipo_beneficio?: 'ferias' | 'licenca_premio'
          exercicio?: string
          modalidade?: 'integral_30' | 'fracionado_15_15' | 'abono_10_20' | 'integral_90' | 'fracionado_45_45'
          sugestao_fracionamento?: Json | null
          opcoes_datas?: Json
          status?: 'aguardando_validacao' | 'deferido' | 'indeferido' | 'contraproposta' | 'cancelado'
          opcao_selecionada?: number | null
          periodo_deferido_p1_inicio?: string | null
          periodo_deferido_p1_fim?: string | null
          periodo_deferido_p2_inicio?: string | null
          periodo_deferido_p2_fim?: string | null
          abono_pecuniario?: boolean
          adicional_terco?: boolean
          observacao_servidor?: string | null
          parecer_coordenador?: string | null
          contraproposta_datas?: Json | null
          validado_por?: string | null
          validado_em?: string | null
          eventos_gerados_ids?: string[] | null
          cancelado_por?: string | null
          cancelado_em?: string | null
          motivo_cancelamento?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      solicitacoes_ferias_licencas_historico: {
        Row: {
          id: string
          solicitacao_id: string
          acao: string
          status_anterior: string | null
          status_novo: string
          executado_por: string | null
          detalhes: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          solicitacao_id: string
          acao: string
          status_anterior?: string | null
          status_novo: string
          executado_por?: string | null
          detalhes?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          solicitacao_id?: string
          acao?: string
          status_anterior?: string | null
          status_novo?: string
          executado_por?: string | null
          detalhes?: Json | null
          created_at?: string
        }
      }
    }
  }
}

