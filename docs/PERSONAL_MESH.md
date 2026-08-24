# Personal Mesh

Your phone and computer can share data directly. There is no relay between them.

## Requirements

- Off Grid Pro must be active on each device.
- Pair each device once on the same Wi-Fi network.
- Use Sync port `37878` on every device, unless you set one different port on every device.
- Restart each app after you change the Sync port.
- Android uses the local network. Apple devices can also use Nearby when Wi-Fi is not available.

Your Sync traffic is encrypted between paired devices. A private address does not remove pairing or
encryption.

## Control who can find you

Open **Settings > Sync**. The two controls have different jobs.

| Control | When it is on | When it is off |
| --- | --- | --- |
| **Discoverable to new devices** | Other devices can find this device for pairing. | This device is Hidden. It does not advertise itself. It can still find other devices, and an existing paired connection stays active. |
| **Find nearby devices** | This device looks for other Off Grid AI devices. | This device stops looking. It can still be discoverable to other devices, and active connections stay active. |

If you save Hidden, the app starts Hidden after a full quit or phone restart. It does not advertise
first and hide later.

## Use one Sync port

The default Sync port is `37878`.

1. Open **Settings > Sync > Connection settings**.
2. Enter a port from `1024` to `65535`.
3. Select **Save**.
4. Set the same port on every paired device.
5. Restart every app.

If one device uses a different port, the devices cannot make the direct connection.

## Connect by private address

Use this when discovery cannot reach a paired device across a private network, VPN, or tailnet.

1. Pair the device on the same Wi-Fi network first.
2. Open **Settings > Sync**.
3. Select the saved device.
4. Select **Connect by address**.
5. Enter the private IP address or machine name, such as `100.116.255.25` or
   `apples-macbook-pro-2`.
6. Select **Save and connect**.

Enter only the address or name. Do not enter `http://`, a path, or a port. Off Grid uses the Sync
port from Connection settings. The saved address belongs to that device only.

## What success looks like

The device row changes to **Connected** and shows the route that is in use. A hidden device does not
appear to a new unpaired device. It can still show devices that it finds when **Find nearby devices**
is on.
