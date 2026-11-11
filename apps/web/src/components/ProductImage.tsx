import { useState } from 'react';

const photos = [
  { key: 'rice', names: /\brice\b/i },
  { key: 'sugar', names: /\bsugar\b/i },
  { key: 'oil', names: /\b(cooking|sunflower|vegetable) oil\b/i },
  { key: 'milk', names: /\bmilk\b/i },
  { key: 'water', names: /\b(bottled|mineral|spring|drinking) water\b/i },
  { key: 'flour', names: /\bflour\b/i },
  { key: 'soda', names: /\b(soft drink|soda|cola)\b/i },
  { key: 'soap', names: /\blaundry soap\b/i },
];

export default function ProductImage({
  name,
  source: uploaded,
}: {
  name: string;
  source?: string;
}) {
  const photo = photos.find((entry) => entry.names.test(name));
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const source = uploaded ?? (photo ? `/images/products/${photo.key}.jpg` : null);

  if (!source || failedSource === source) {
    return <span className="product-image-placeholder">No photo available</span>;
  }

  return (
    <img
      className="product-image"
      data-photo={photo?.key}
      src={source}
      alt={uploaded ? name : `Representative photo of ${name}`}
      loading="lazy"
      decoding="async"
      width="400"
      height="400"
      onError={() => setFailedSource(source)}
    />
  );
}

export function ProductPhotoCredits() {
  return (
    <p className="product-photo-credits">
      Representative product photos; brands and packaging may vary.{' '}
      <a href="/images/products/credits.html" target="_blank" rel="noreferrer">
        Photo credits
      </a>
    </p>
  );
}
