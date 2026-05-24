import React from "react";
import ReceiptDetailClient from "../../../components/ReceiptDetailClient";

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ReceiptDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <ReceiptDetailClient receiptId={id} />;
}
