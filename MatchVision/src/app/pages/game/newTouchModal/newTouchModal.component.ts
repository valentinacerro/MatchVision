import { Component, EventEmitter, inject, Input, Output, TemplateRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgbModal, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { Player } from '../../../Models/Player';

@Component({
    selector: 'app-new-touch-modal',
    standalone: true,
    imports: [
        FormsModule,
    ],
    templateUrl: './newTouchModal.component.html',
    styleUrls: ['./newTouchModal.component.scss']
})

export class NewTouchModalComponent{

    private modalService = inject(NgbModal)
    private modalRef: NgbModalRef | null = null
    @ViewChild('content', { static: true }) content!: TemplateRef<any>

    @Output() newTouchCreated = new EventEmitter<{fundamental: string; outcome: string}>()
    @Input() player!: Player | null

    fundamental = ''
    outcome = ''

    open() {
        // Fresh choices every time, also after a dismiss
        this.fundamental = ''
        this.outcome = ''
        this.modalRef = this.modalService.open(this.content, { ariaLabelledBy: 'modal-new-touch' })
	}

    // The touch is saved as soon as both fundamental and outcome are chosen.
    // One save per open: taps during the closing animation are ignored.
    trySubmit(): void {
        if (!this.modalRef || this.fundamental === '' || this.outcome === '') return
        const ref = this.modalRef
        this.modalRef = null
        this.newTouchCreated.emit({
            fundamental: this.fundamental,
            outcome: this.outcome
        })
        ref.close()
    }
}
