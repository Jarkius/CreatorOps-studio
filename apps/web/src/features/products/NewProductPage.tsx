import { Link, useNavigate, useParams } from 'react-router';

import type { CreateProductRequest, Product, UpdateProductRequest } from '@creatorops/contracts';

import { ProductForm } from './ProductForm.js';
import { productPath, productsPath } from './paths.js';
import { useCreateProduct } from './productQueries.js';

export function NewProductPage() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();
  const create = useCreateProduct(workspaceId);

  const save = async (body: CreateProductRequest | UpdateProductRequest): Promise<Product> => {
    const product = await create.mutateAsync(body as CreateProductRequest);
    navigate(productPath(workspaceId, product.id));
    return product;
  };

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-2">
        <Link
          to={productsPath(workspaceId)}
          className="inline-flex min-h-11 items-center text-[var(--co-accent)] underline underline-offset-4"
        >
          Back to products
        </Link>
        <h1 className="text-2xl font-semibold leading-relaxed">New product</h1>
      </header>
      <ProductForm mode="create" submitLabel="Create product" onSave={save} />
    </div>
  );
}
