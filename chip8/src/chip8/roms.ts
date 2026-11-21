// The programs the app ships, as source: `assemble()` turns them into bytes when one is opened.

export interface Program {
  name: string;
  about: string;
  source: string;
}

const BOUNCE = `
; A ball that beeps off the walls.
; V0 x, V1 y, V2 and V3 the step on each axis (255 is -1), V4 scratch
start:  CLS
        LD   V0, 10
        LD   V1, 5
        LD   V2, 1
        LD   V3, 1
        LD   I, ball
        DRW  V0, V1, 2
loop:   LD   V4, 1
        LD   DT, V4
wait:   LD   V4, DT
        SE   V4, 0
        JP   wait
        DRW  V0, V1, 2      ; drawing it again erases it
        ADD  V0, V2
        ADD  V1, V3
        SNE  V0, 0
        CALL right
        SNE  V0, 62
        CALL left
        SNE  V1, 0
        CALL down
        SNE  V1, 30
        CALL up
        DRW  V0, V1, 2
        JP   loop
right:  LD   V2, 1
        JP   beep
left:   LD   V2, 255
        JP   beep
down:   LD   V3, 1
        JP   beep
up:     LD   V3, 255
beep:   LD   V4, 2
        LD   ST, V4
        RET
ball:   DB   0xC0, 0xC0
`;

const CATCH = `
; Catch the falling drop with the paddle: 4 moves it left, 6 right.
; VA paddle x, VB paddle y, VC drop x, VD drop y, VE score; V0 to V4 scratch
start:  CLS
        LD   VA, 28
        LD   VB, 30
        LD   VE, 0
        CALL score
        LD   I, paddle
        DRW  VA, VB, 1
next:   RND  VC, 0x3E
        LD   VD, 8
        LD   I, drop
        DRW  VC, VD, 2
fall:   LD   V0, 2
        LD   DT, V0
wait:   LD   V0, DT
        SE   V0, 0
        JP   wait
        LD   V0, 4
        SKNP V0
        CALL left
        LD   V0, 6
        SKNP V0
        CALL right
        LD   I, drop
        DRW  VC, VD, 2
        ADD  VD, 1
        SNE  VD, 29
        JP   landed
        DRW  VC, VD, 2
        JP   fall
landed: LD   V0, VC         ; caught when 0 <= drop x - paddle x < 8
        SUB  V0, VA
        SE   VF, 1
        JP   missed
        LD   V1, 8
        SUB  V0, V1
        SNE  VF, 1
        JP   missed
        CALL score
        ADD  VE, 1
        CALL score
        LD   V0, 3
        LD   ST, V0
        JP   next
missed: LD   V0, 20
        LD   ST, V0
        CALL score
        LD   VE, 0
        CALL score
        JP   next
left:   SNE  VA, 0
        RET
        LD   I, paddle
        DRW  VA, VB, 1
        ADD  VA, 252
        DRW  VA, VB, 1
        RET
right:  SNE  VA, 56
        RET
        LD   I, paddle
        DRW  VA, VB, 1
        ADD  VA, 4
        DRW  VA, VB, 1
        RET
score:  LD   I, digits      ; draws the two digits; a second call erases them
        LD   B, VE
        LD   V2, [I]
        LD   V3, 1
        LD   V4, 1
        LD   F, V1
        DRW  V3, V4, 5
        ADD  V3, 5
        LD   F, V2
        DRW  V3, V4, 5
        RET
paddle: DB   0xFF
drop:   DB   0xC0, 0xC0
digits: DB   0, 0, 0
`;

export const PROGRAMS: Program[] = [
  { name: "Bounce", about: "A ball that beeps off the walls", source: BOUNCE },
  { name: "Catch", about: "Catch the drop: 4 and 6 move the paddle", source: CATCH },
];
