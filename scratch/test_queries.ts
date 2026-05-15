import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

async function testQuery() {
  console.log('Testing query on escala_mensal...')
  const { data, error } = await supabase
    .from('escala_mensal')
    .select('*, servidores(nome), unidades(nome), setores(dicionario_setores(nome))')
    .limit(1)

  if (error) {
    console.error('Error on escala_mensal:', error)
  } else {
    console.log('Success on escala_mensal:', JSON.stringify(data, null, 2))
  }

  console.log('\nTesting query on setores...')
  const { data: data2, error: error2 } = await supabase
    .from('setores')
    .select('*, dicionario_setores(nome)')
    .limit(1)

  if (error2) {
    console.error('Error on setores:', error2)
  } else {
    console.log('Success on setores:', JSON.stringify(data2, null, 2))
  }
}

testQuery()
