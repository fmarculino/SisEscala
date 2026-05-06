'use client'

import { useState } from 'react'
import { MapPin, Loader2 } from 'lucide-react'

interface GeoLocationPickerProps {
  defaultLat?: number | null
  defaultLong?: number | null
  defaultRaio?: number | null
}

export function GeoLocationPicker({ defaultLat, defaultLong, defaultRaio }: GeoLocationPickerProps) {
  const [loading, setLoading] = useState(false)
  const [lat, setLat] = useState(defaultLat?.toString() || '')
  const [long, setLong] = useState(defaultLong?.toString() || '')

  const getMyLocation = () => {
    setLoading(true)
    if (!navigator.geolocation) {
      alert('Geolocalização não é suportada pelo seu navegador.')
      setLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toString())
        setLong(position.coords.longitude.toString())
        setLoading(false)
      },
      (error) => {
        alert('Erro ao obter localização: ' + error.message)
        setLoading(false)
      }
    )
  }

  return (
    <div className="space-y-4 border-t border-zinc-100 dark:border-zinc-800 pt-6 mt-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-white flex items-center">
          <MapPin className="mr-2 h-4 w-4 text-blue-600" />
          Geolocalização (Check-in Digital)
        </h3>
        <button
          type="button"
          onClick={getMyLocation}
          disabled={loading}
          className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded"
        >
          {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <MapPin className="mr-1 h-3 w-3" />}
          Pegar Localização Atual
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="latitude" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Latitude
          </label>
          <input
            type="number"
            step="any"
            name="latitude"
            id="latitude"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="longitude" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Longitude
          </label>
          <input
            type="number"
            step="any"
            name="longitude"
            id="longitude"
            value={long}
            onChange={(e) => setLong(e.target.value)}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="raio_geofence" className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Raio de Tolerância (metros)
        </label>
        <input
          type="number"
          name="raio_geofence"
          id="raio_geofence"
          defaultValue={defaultRaio || 100}
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-900 dark:bg-zinc-800 dark:text-white sm:text-sm"
        />
        <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          Define a distância máxima que o servidor pode estar da unidade para validar o plantão.
        </p>
      </div>
    </div>
  )
}
