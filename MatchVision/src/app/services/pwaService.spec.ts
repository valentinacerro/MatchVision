import { provideZonelessChangeDetection } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { SwUpdate, VersionEvent } from '@angular/service-worker'
import { Subject } from 'rxjs'
import { PwaService } from './pwaService'

describe('PwaService', () => {
    let versionUpdates: Subject<VersionEvent>
    let swUpdate: jasmine.SpyObj<SwUpdate>

    beforeEach(() => {
        versionUpdates = new Subject<VersionEvent>()
        swUpdate = jasmine.createSpyObj('SwUpdate', ['checkForUpdate', 'activateUpdate'],
            { isEnabled: true, versionUpdates, unrecoverable: new Subject() })
        swUpdate.activateUpdate.and.resolveTo(true)
        TestBed.configureTestingModule({
            providers: [provideZonelessChangeDetection(), { provide: SwUpdate, useValue: swUpdate }]
        })
    })

    it('offers the update only when the new version is ready', () => {
        const pwa = TestBed.inject(PwaService)
        versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } })
        expect(pwa.updateReady()).toBeFalse()
        versionUpdates.next({ type: 'VERSION_READY', currentVersion: { hash: 'a' }, latestVersion: { hash: 'b' } })
        expect(pwa.updateReady()).toBeTrue()
    })

    it('follows the connection', () => {
        const pwa = TestBed.inject(PwaService)
        window.dispatchEvent(new Event('offline'))
        expect(pwa.offline()).toBeTrue()
        window.dispatchEvent(new Event('online'))
        expect(pwa.offline()).toBeFalse()
    })

    it('shows the install button when the browser allows it', async () => {
        const pwa = TestBed.inject(PwaService)
        expect(pwa.canInstall()).toBeFalse()
        const prompt = Object.assign(new Event('beforeinstallprompt', { cancelable: true }),
            { prompt: jasmine.createSpy('prompt'), userChoice: Promise.resolve({ outcome: 'accepted' }) })
        window.dispatchEvent(prompt)
        expect(pwa.canInstall()).toBeTrue()
        expect(prompt.defaultPrevented).toBeTrue()
        await pwa.install()
        expect(prompt.prompt).toHaveBeenCalled()
        expect(pwa.canInstall()).toBeFalse()
    })
})
