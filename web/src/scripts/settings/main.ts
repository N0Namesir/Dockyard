// Página de Configuración. La API decide si hay versión nueva y si se puede actualizar; aquí solo se
// muestra, se guardan los ajustes y se sigue la actualización mientras Dockyard se reinicia.
import { api, messageOf } from '../projects/api.ts'
import { confirmAction, setupConfirmDialog } from '../projects/confirm-dialog.ts'
import type { VersionInfo } from '../projects/types.ts'

interface Settings {
  updateCheck: boolean
}

interface SelfUpdate {
  supported: boolean
  running: boolean
  last: { exitCode: number | null; finishedAt: string | null; log: string } | null
}

const RELEASES_URL = 'https://github.com/N0Namesir/Dockyard/releases/tag/'
const POLL_MS = 3_000
/** Una actualización normal tarda unos minutos; pasado esto se avisa, sin dejar de esperar. */
const SLOW_AFTER_MS = 10 * 60 * 1000

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const versionCurrent = $('#version-current')
const versionLatest = $('#version-latest')
const versionChecked = $('#version-checked')
const checkNow = $<HTMLButtonElement>('#check-now')
const checkMessage = $('#check-message')
const updateBox = $('#update-box')
const updateVersion = $('#update-version')
const updateNotes = $<HTMLAnchorElement>('#update-notes')
const updateNow = $<HTMLButtonElement>('#update-now')
const updateUnsupported = $('#update-unsupported')
const updateRunning = $('#update-running')
const updateRunningText = $('#update-running-text')
const updateResult = $('#update-result')
const updateResultText = $('#update-result-text')
const updateLogBox = $<HTMLDetailsElement>('#update-log-box')
const updateLog = $('#update-log')
const updateCheck = $<HTMLInputElement>('#update-check')
const settingsError = $('#settings-error')

let version: VersionInfo | null = null
let selfUpdate: SelfUpdate | null = null
/** Versión con la que empezó la actualización: cuando la API responde otra, ya terminó. */
let updatingFrom: string | null = null

function dateText(iso: string): string {
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

function showError(message: string | null): void {
  settingsError.textContent = message ?? ''
  settingsError.classList.toggle('hidden', message === null)
}

function showResult(kind: 'ok' | 'error', text: string, log = ''): void {
  updateResult.hidden = false
  updateResult.className = `rounded-md border p-4 text-sm ${kind === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`
  updateResultText.textContent = text
  updateLog.textContent = log
  updateLogBox.hidden = log === ''
  updateLogBox.open = kind === 'error'
}

function render(): void {
  if (version) {
    versionCurrent.textContent = `v${version.current}`
    versionLatest.textContent = version.latest ?? 'Sin datos'
    versionChecked.textContent = version.checkedAt ? dateText(version.checkedAt) : 'Aún no'
  }
  const updating = updatingFrom !== null
  updateRunning.hidden = !updating
  const available = !updating && version?.updateAvailable === true && version.latest !== null
  updateBox.hidden = !available
  if (available) {
    updateVersion.textContent = version!.latest
    updateNotes.href = RELEASES_URL + version!.latest
    const supported = selfUpdate?.supported ?? false
    updateNow.hidden = !supported
    updateUnsupported.hidden = supported
  }
  checkNow.disabled = updating
}

/** Resultado de la última actualización desde la página, si no es la que está corriendo. */
function renderLast(): void {
  const last = selfUpdate?.last
  if (!last || selfUpdate?.running || last.exitCode === null) return
  if (last.exitCode === 0) {
    showResult('ok', `La última actualización terminó bien${last.finishedAt ? ` (${dateText(last.finishedAt)})` : ''}.`, last.log)
    updateLogBox.open = false
  } else {
    showResult('error', 'La última actualización no se completó y Dockyard sigue con la versión anterior. La causa está al final de la salida.', last.log)
  }
}

async function load(): Promise<void> {
  const [versionResult, settingsResult, selfUpdateResult] = await Promise.allSettled([
    api<VersionInfo>('/api/version'),
    api<Settings>('/api/settings'),
    api<SelfUpdate>('/api/update'),
  ])
  if (versionResult.status === 'fulfilled') version = versionResult.value
  if (selfUpdateResult.status === 'fulfilled') selfUpdate = selfUpdateResult.value
  if (settingsResult.status === 'fulfilled') {
    updateCheck.checked = settingsResult.value.updateCheck
    updateCheck.disabled = false
  }
  const failed = [versionResult, settingsResult, selfUpdateResult].find((result) => result.status === 'rejected')
  if (failed) showError(messageOf(failed.reason, 'No se pudo cargar la configuración.'))
  if (selfUpdate?.running && version) {
    // Otra pestaña, o esta antes de recargar, empezó una actualización que sigue corriendo.
    void follow(version.current)
  }
  render()
  renderLast()
}

async function check(): Promise<void> {
  checkNow.disabled = true
  checkMessage.textContent = 'Consultando GitHub…'
  try {
    version = await api<VersionInfo>('/api/version/check', { method: 'POST' })
    checkMessage.textContent = version.updateAvailable ? 'Hay una versión nueva.' : 'Tienes la última versión.'
  } catch (error) {
    checkMessage.textContent = messageOf(error, 'No se pudo consultar GitHub.')
  } finally {
    render()
  }
}

async function saveUpdateCheck(): Promise<void> {
  const wanted = updateCheck.checked
  updateCheck.disabled = true
  showError(null)
  try {
    const saved = await api<Settings>('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ updateCheck: wanted }),
    })
    updateCheck.checked = saved.updateCheck
  } catch (error) {
    updateCheck.checked = !wanted
    showError(messageOf(error, 'No se pudo guardar el ajuste.'))
  } finally {
    updateCheck.disabled = false
  }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * Espera a que Dockyard vuelva con otra versión. Mientras se reinicia, la API no responde: esas
 * fallas son normales y se sigue esperando.
 */
async function follow(from: string): Promise<void> {
  updatingFrom = from
  updateResult.hidden = true
  render()
  const started = Date.now()
  for (;;) {
    await wait(POLL_MS)
    if (Date.now() - started > SLOW_AFTER_MS) {
      updateRunningText.textContent = 'Está tardando más de lo normal. Si no termina, abre una terminal en la carpeta de Dockyard y ejecuta ./update.sh.'
    }
    let now: VersionInfo
    let status: SelfUpdate
    try {
      ;[now, status] = await Promise.all([api<VersionInfo>('/api/version'), api<SelfUpdate>('/api/update')])
    } catch {
      continue
    }
    if (now.current !== from) {
      updateRunningText.textContent = `Dockyard se actualizó a la v${now.current}. Recargando…`
      await wait(1_500)
      location.reload()
      return
    }
    if (!status.running && status.last?.exitCode !== null && status.last?.exitCode !== undefined) {
      // update.sh terminó sin cambiar la versión: falló antes de reconstruir.
      updatingFrom = null
      selfUpdate = status
      version = now
      render()
      if (status.last.exitCode === 0) location.reload()
      else showResult('error', 'No se pudo actualizar. Dockyard sigue con la versión anterior y funciona como antes. La causa está al final de la salida.', status.last.log)
      return
    }
  }
}

async function update(): Promise<void> {
  if (!version?.latest) return
  const confirmed = await confirmAction({
    title: `¿Actualizar a la ${version.latest}?`,
    text: 'Dockyard se reinicia durante uno o dos minutos. Los proyectos encendidos siguen encendidos, pero no podrás usar Dockyard mientras tanto.',
    confirmLabel: 'Actualizar ahora',
  })
  if (!confirmed) return
  updateNow.disabled = true
  showError(null)
  try {
    selfUpdate = await api<SelfUpdate>('/api/update', { method: 'POST' })
    void follow(version.current)
  } catch (error) {
    showError(messageOf(error, 'No se pudo empezar la actualización.'))
  } finally {
    updateNow.disabled = false
  }
}

setupConfirmDialog()
checkNow.addEventListener('click', () => void check())
updateNow.addEventListener('click', () => void update())
updateCheck.addEventListener('change', () => void saveUpdateCheck())
void load()
