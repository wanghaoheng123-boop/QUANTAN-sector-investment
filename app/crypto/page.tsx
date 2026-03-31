import { redirect } from 'next/navigation'

/** Hub route — only BTC is implemented; avoid 404 on /crypto. */
export default function CryptoIndexPage() {
  redirect('/crypto/btc')
}
