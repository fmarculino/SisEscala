import { createClient } from '@/utils/supabase/server'
import { CargosClient } from './CargosClient'

export default async function CargosPage() {
  const supabase = await createClient()
  
  const { data: cargos } = await supabase
    .from('cargos')
    .select('*')
    .order('nome')

  return (
    <CargosClient initialCargos={cargos || []} />
  )
}
