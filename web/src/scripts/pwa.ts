// Instalación bajo una acción del docente; no muestra solicitudes automáticas.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const button = document.querySelector<HTMLButtonElement>('#install-app')!
const help = document.querySelector<HTMLDialogElement>('#install-help')!
const status = document.querySelector<HTMLElement>('#install-status')!
const standalone = window.matchMedia('(display-mode: standalone)')
let deferredPrompt: InstallPromptEvent | null = null
let installed = standalone.matches

function updateButton(): void {
  button.hidden = installed || standalone.matches
}
updateButton()
standalone.addEventListener('change', updateButton)

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  deferredPrompt = event as InstallPromptEvent
})
window.addEventListener('appinstalled', () => {
  installed = true
  deferredPrompt = null
  updateButton()
  if (help.open) help.close()
})
button.addEventListener('click', async () => {
  const prompt = deferredPrompt
  if (!prompt) {
    status.textContent = ''
    help.showModal()
    return
  }
  deferredPrompt = null
  button.disabled = true
  try {
    await prompt.prompt()
    const choice = await prompt.userChoice
    if (choice.outcome === 'accepted') {
      installed = true
      updateButton()
    }
  } catch {
    status.textContent = 'No se pudo abrir la instalación. Puedes usar el menú del navegador.'
    help.showModal()
  } finally {
    button.disabled = false
  }
})
help.addEventListener('close', () => {
  if (!button.hidden) button.focus()
})

// Solo producción: el worker no debe interceptar la recarga del servidor de desarrollo.
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
    // La interfaz y la instalación por el navegador siguen disponibles sin caché de ayuda.
  })
}
