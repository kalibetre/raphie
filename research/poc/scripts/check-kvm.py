"""Read-only KVM capability check: opens the device and queries its API version."""
import fcntl
import os

descriptor = os.open('/dev/kvm', os.O_RDWR | os.O_CLOEXEC)
try:
    print('KVM_API_VERSION=' + str(fcntl.ioctl(descriptor, 0xAE00, 0)))
finally:
    os.close(descriptor)
