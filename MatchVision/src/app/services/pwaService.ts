import { Injectable, inject, signal } from '@angular/core'
import { SwUpdate } from '@angular/service-worker'
import { filter } from 'rxjs'

const IOS_HINT_KEY = 'matchvision.iosInstallHint'

// Installed app: new versions, connection, install prompt
@Injectable({
    providedIn: 'root'
})
export class PwaService {

    private swUpdate = inject(SwUpdate)
    private installPrompt: any = null

    readonly updateReady = signal(false)
    readonly offline = signal(!navigator.onLine)
    readonly canInstall = signal(false)
    readonly iosHint = signal(this.isIos() && !this.isInstalled() && !this.hintDismissed())

    constructor() {
        window.addEventListener('online', () => this.offline.set(false))
        window.addEventListener('offline', () => this.offline.set(true))
        // Chrome, Edge and Android: the install button appears when the browser allows it
        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault()
            this.installPrompt = event
            this.canInstall.set(true)
        })
        window.addEventListener('appinstalled', () => {
            this.installPrompt = null
            this.canInstall.set(false)
        })
        if (!this.swUpdate.isEnabled) return
        // A new version is downloaded in the background and used after a reload chosen by the user:
        // never in the middle of a rally
        this.swUpdate.versionUpdates.pipe(filter(e => e.type === 'VERSION_READY')).subscribe(() => this.updateReady.set(true))
        this.swUpdate.unrecoverable.subscribe(() => this.updateReady.set(true))
        // An open app (a whole tournament day) looks for new versions now and then
        setInterval(() => this.swUpdate.checkForUpdate().catch(() => {}), 30 * 60 * 1000)
    }

    async install(): Promise<void> {
        if (!this.installPrompt) return
        this.installPrompt.prompt()
        await this.installPrompt.userChoice.catch(() => null)
        this.installPrompt = null
        this.canInstall.set(false)
    }

    // Nothing is lost: every change of the game screen is already on the device
    async update(): Promise<void> {
        await this.swUpdate.activateUpdate().catch(() => false)
        document.location.reload()
    }

    dismissIosHint(): void {
        this.iosHint.set(false)
        try { localStorage.setItem(IOS_HINT_KEY, '1') } catch {}
    }

    // iPadOS presents itself as a Mac with a touch screen
    private isIos(): boolean {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
    }

    private isInstalled(): boolean {
        return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true
    }

    private hintDismissed(): boolean {
        try { return localStorage.getItem(IOS_HINT_KEY) === '1' } catch { return false }
    }
}
