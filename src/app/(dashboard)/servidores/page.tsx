import { createClient } from '@/utils/supabase/server'
import { ServidoresClient } from './ServidoresClient'

export default async function ServidoresPage() {
  const supabase = await createClient()
  
  // Fetch servers with unit and sector info
  const { data: servidores } = await supabase
    .from('servidores')
    .select('*, unidades(nome), setores(nome)')
    .order('nome')

  // Fetch units and sectors for filters
  const { data: unidades } = await supabase.from('unidades').select('id, nome').order('nome')
  const { data: setores } = await supabase.from('setores').select('id, nome, unidade_id').order('nome')

  return (
    <ServidoresClient 
      initialServidores={servidores || []} 
      unidades={unidades || []} 
      setores={setores || []} 
    />
  )
}
