import { Component } from '@angular/core';

@Component({
  selector: 'app-inline',
  template: '<p>inline</p>',
  styles: [
`
:root { --inline-accent: #123456; }
.box { color: #123456; }
.btn { border-color: var(--inline-accent); }
`
  ],
})
export class InlineComponent {}
