section .text

global test_idiv_64
test_idiv_64:
mov rdx, 0xbf01
mov rax, 0x800000007F65B9DD
mov rcx, rax
mov rax, 0x11
idiv rcx
ret

global test_idiv_32
test_idiv_32:
mov edx, 0x12345678
mov ecx, 0x1000
mov eax, 0x87654321
idiv ecx
ret

global test_idiv_16
test_idiv_16:
mov dx, 0x1234
mov ax, 0x5678
mov cx, 0x100
idiv cx
ret

global test_idiv_8
test_idiv_8:
mov ax, 0x1278
mov cl, 0x10
idiv cl
ret