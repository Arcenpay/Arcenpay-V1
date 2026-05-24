"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useQuery, useMutation } from "convex/react";
import convexClient from "@/lib/convexClient";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  FileText,
  Calendar,
  DollarSign,
  Store,
  Trash2,
  Download,
  Eye,
  Loader2,
  Package,
  Search,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function ReceiptsClient() {
  const router = useRouter();
  const { user } = useUser();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "amount" | "merchant">("date");

  const receipts = useQuery(
    api.receipts.getReceipts,
    user?.id ? { userId: user.id } : "skip",
  );

  const deleteReceiptMutation = useMutation(api.receipts.deleteReceipt);

  // Filter and sort receipts
  const filteredReceipts = useMemo(() => {
    if (!receipts) return [];

    let filtered = [...receipts];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (receipt) =>
          receipt.fileName.toLowerCase().includes(query) ||
          receipt.merchantName?.toLowerCase().includes(query) ||
          receipt.transactionDate?.toLowerCase().includes(query),
      );
    }

    // Apply status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter((receipt) => receipt.status === statusFilter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "date":
          return (b.uploadedAt || 0) - (a.uploadedAt || 0);
        case "amount":
          return (b.transactionAmount || 0) - (a.transactionAmount || 0);
        case "merchant":
          return (a.merchantName || "").localeCompare(b.merchantName || "");
        default:
          return 0;
      }
    });

    return filtered;
  }, [receipts, searchQuery, statusFilter, sortBy]);

  const handleDelete = async (receiptId: Id<"receipts">) => {
    if (!confirm("Are you sure you want to delete this receipt?")) return;

    try {
      await deleteReceiptMutation({ id: receiptId });
    } catch (error) {
      console.error("Error deleting receipt:", error);
      alert("Failed to delete receipt. Please try again.");
    }
  };

  const handleDownload = async (fileId: Id<"_storage">, fileName: string) => {
    try {
      // Use Convex client to get download URL
      const url = await convexClient.query(api.receipts.getReceiptDownloadUrl, {
        fileId,
      });

      if (url) {
        // Open in new tab or trigger download
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert("Failed to generate download URL. Please try again.");
      }
    } catch (error) {
      console.error("Error downloading receipt:", error);
      alert("Failed to download receipt. Please try again.");
    }
  }; // Calculate stats
  const stats = useMemo(() => {
    if (!receipts)
      return { total: 0, completed: 0, processing: 0, totalAmount: 0 };

    return {
      total: receipts.length,
      completed: receipts.filter((r) => r.status === "completed").length,
      processing: receipts.filter((r) => r.status === "processing").length,
      totalAmount: receipts.reduce(
        (sum, r) => sum + (r.transactionAmount || 0),
        0,
      ),
    };
  }, [receipts]);

  if (!user) {
    return (
      <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-black dark:text-white mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-black dark:text-white mb-2">
            Sign In Required
          </h2>
          <p className="text-black dark:text-white">
            Please sign in to view your receipts
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-black">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-black dark:text-white mb-2">
            My Receipts
          </h1>
          <p className="text-black dark:text-white">
            View and manage all your uploaded receipts
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Total Receipts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Completed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.completed}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Processing</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.processing}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Spent</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${stats.totalAmount.toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Search */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4">
              {/* Search */}
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-black dark:text-white" />
                  <input
                    type="text"
                    placeholder="Search by filename, merchant, or date..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-black dark:border-white rounded-lg bg-white dark:bg-black text-black dark:text-white placeholder:text-black/50 dark:placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
                  />
                </div>
              </div>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-black dark:border-white rounded-lg bg-white dark:bg-black text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
              >
                <option value="all">All Status</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>

              {/* Sort By */}
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as "date" | "amount" | "merchant")
                }
                className="px-4 py-2 border border-black dark:border-white rounded-lg bg-white dark:bg-black text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white"
              >
                <option value="date">Sort by Date</option>
                <option value="amount">Sort by Amount</option>
                <option value="merchant">Sort by Merchant</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Receipts List */}
        <Card>
          <CardHeader>
            <CardTitle>Receipts ({filteredReceipts.length})</CardTitle>
            <CardDescription>
              {searchQuery || statusFilter !== "all"
                ? `Showing filtered results`
                : `All your receipts`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!receipts ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-black dark:text-white" />
              </div>
            ) : filteredReceipts.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-16 w-16 text-black dark:text-white mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-black dark:text-white mb-2">
                  {searchQuery || statusFilter !== "all"
                    ? "No receipts found"
                    : "No receipts yet"}
                </h3>
                <p className="text-black dark:text-white mb-4">
                  {searchQuery || statusFilter !== "all"
                    ? "Try adjusting your filters"
                    : "Upload your first receipt to get started"}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredReceipts.map((receipt) => (
                  <div
                    key={receipt._id}
                    className="flex items-center justify-between p-4 border border-black dark:border-white rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="p-2 bg-black dark:bg-white rounded-lg shrink-0">
                        <FileText className="h-6 w-6 text-white dark:text-black" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-black dark:text-white truncate">
                            {receipt.fileName}
                          </h4>
                          <Badge
                            variant={
                              receipt.status === "completed"
                                ? "default"
                                : receipt.status === "processing"
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {receipt.status}
                          </Badge>
                        </div>

                        <div className="flex flex-wrap gap-4 text-sm text-black dark:text-white">
                          {receipt.merchantName && (
                            <div className="flex items-center gap-1">
                              <Store className="h-4 w-4" />
                              <span>{receipt.merchantName}</span>
                            </div>
                          )}
                          {receipt.transactionDate && (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-4 w-4" />
                              <span>{receipt.transactionDate}</span>
                            </div>
                          )}
                          {receipt.transactionAmount !== undefined && (
                            <div className="flex items-center gap-1">
                              <DollarSign className="h-4 w-4" />
                              <span>
                                {receipt.currency || "$"}
                                {receipt.transactionAmount.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {receipt.items && receipt.items.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Package className="h-4 w-4" />
                              <span>{receipt.items.length} items</span>
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-black/50 dark:text-white/50">
                            <Calendar className="h-4 w-4" />
                            <span>
                              {new Date(
                                receipt.uploadedAt,
                              ).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          router.push(`/recipts/${receipt._id}`);
                        }}
                        title="View details"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          handleDownload(receipt.fileId, receipt.fileName)
                        }
                        title="Download receipt"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(receipt._id)}
                        title="Delete receipt"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
