DROP INDEX "account_providerId_accountId_key";--> statement-breakpoint
DROP INDEX "Address_customerId_idx";--> statement-breakpoint
DROP INDEX "Address_orderId_idx";--> statement-breakpoint
DROP INDEX "AiIntegration_organizationId_idx";--> statement-breakpoint
DROP INDEX "AiIntegration_organizationId_isDefault_idx";--> statement-breakpoint
DROP INDEX "AiIntegration_organizationId_modelType_idx";--> statement-breakpoint
DROP INDEX "AiIntegration_organizationId_providerType_idx";--> statement-breakpoint
DROP INDEX "AiIntegration_provider_organizationId_key";--> statement-breakpoint
DROP INDEX "AiUsage_createdAt_idx";--> statement-breakpoint
DROP INDEX "AiUsage_organizationId_createdAt_idx";--> statement-breakpoint
DROP INDEX "AiUsage_provider_model_idx";--> statement-breakpoint
DROP INDEX "ApiKey_hashedKey_key";--> statement-breakpoint
DROP INDEX "ApiKey_userId_isActive_idx";--> statement-breakpoint
DROP INDEX "ApprovalRequest_createdById_idx";--> statement-breakpoint
DROP INDEX "ApprovalRequest_organizationId_assigneeGroups_idx";--> statement-breakpoint
DROP INDEX "ApprovalRequest_organizationId_assigneeUsers_idx";--> statement-breakpoint
DROP INDEX "ApprovalRequest_organizationId_idx";--> statement-breakpoint
DROP INDEX "ApprovalRequest_status_expiresAt_idx";--> statement-breakpoint
DROP INDEX "ApprovalRequest_workflowRunId_idx";--> statement-breakpoint
DROP INDEX "ApprovalResponse_approvalRequestId_userId_key";--> statement-breakpoint
DROP INDEX "ApprovalResponse_userId_idx";--> statement-breakpoint
DROP INDEX "ArticleTag_name_organizationId_key";--> statement-breakpoint
DROP INDEX "Article_isCategory_idx";--> statement-breakpoint
DROP INDEX "Article_knowledgeBaseId_idx";--> statement-breakpoint
DROP INDEX "Article_knowledgeBaseId_slug_key";--> statement-breakpoint
DROP INDEX "Article_parentId_idx";--> statement-breakpoint
DROP INDEX "Attachment_assetId_idx";--> statement-breakpoint
DROP INDEX "Attachment_createdAt_idx";--> statement-breakpoint
DROP INDEX "Attachment_entityType_entityId_idx";--> statement-breakpoint
DROP INDEX "Attachment_fileId_idx";--> statement-breakpoint
DROP INDEX "Attachment_id_organizationId_key";--> statement-breakpoint
DROP INDEX "Attachment_organizationId_entityType_entityId_idx";--> statement-breakpoint
DROP INDEX "AutoResponseRule_organizationId_isActive_idx";--> statement-breakpoint
DROP INDEX "AutoResponseRule_organizationId_name_key";--> statement-breakpoint
DROP INDEX "AutoResponseRule_priority_idx";--> statement-breakpoint
DROP INDEX "ChatAttachment_messageId_idx";--> statement-breakpoint
DROP INDEX "ChatAttachment_sessionId_idx";--> statement-breakpoint
DROP INDEX "ChatMessage_agentId_idx";--> statement-breakpoint
DROP INDEX "ChatMessage_createdAt_idx";--> statement-breakpoint
DROP INDEX "ChatMessage_sessionId_idx";--> statement-breakpoint
DROP INDEX "ChatMessage_threadId_idx";--> statement-breakpoint
DROP INDEX "ChatSession_lastActivityAt_idx";--> statement-breakpoint
DROP INDEX "ChatSession_organizationId_idx";--> statement-breakpoint
DROP INDEX "ChatSession_status_idx";--> statement-breakpoint
DROP INDEX "ChatSession_visitorId_idx";--> statement-breakpoint
DROP INDEX "ChatSession_widgetId_idx";--> statement-breakpoint
DROP INDEX "ChatWidget_integrationId_key";--> statement-breakpoint
DROP INDEX "ChatWidget_organizationId_idx";--> statement-breakpoint
DROP INDEX "ChatWidget_organizationId_name_key";--> statement-breakpoint
DROP INDEX "CommentMention_commentId_idx";--> statement-breakpoint
DROP INDEX "CommentMention_commentId_userId_key";--> statement-breakpoint
DROP INDEX "CommentMention_userId_idx";--> statement-breakpoint
DROP INDEX "CommentReaction_commentId_idx";--> statement-breakpoint
DROP INDEX "CommentReaction_commentId_userId_type_emoji_key";--> statement-breakpoint
DROP INDEX "CommentReaction_type_idx";--> statement-breakpoint
DROP INDEX "CommentReaction_userId_idx";--> statement-breakpoint
DROP INDEX "Comment_createdById_idx";--> statement-breakpoint
DROP INDEX "Comment_deletedAt_idx";--> statement-breakpoint
DROP INDEX "Comment_entityId_entityType_idx";--> statement-breakpoint
DROP INDEX "Comment_isPinned_idx";--> statement-breakpoint
DROP INDEX "Comment_organizationId_idx";--> statement-breakpoint
DROP INDEX "Comment_parentId_idx";--> statement-breakpoint
DROP INDEX "Comment_threadId_idx";--> statement-breakpoint
DROP INDEX "Comment_ticketId_idx";--> statement-breakpoint
DROP INDEX "Contact_emails_idx";--> statement-breakpoint
DROP INDEX "Contact_organizationId_email_key";--> statement-breakpoint
DROP INDEX "Contact_organizationId_idx";--> statement-breakpoint
DROP INDEX "Contact_organizationId_phone_idx";--> statement-breakpoint
DROP INDEX "Contact_organizationId_status_idx";--> statement-breakpoint
DROP INDEX "CustomExtractionRule_organizationId_entityType_templateId_key";--> statement-breakpoint
DROP INDEX "CustomExtractionRule_organizationId_isActive_idx";--> statement-breakpoint
DROP INDEX "CustomExtractionRule_templateId_idx";--> statement-breakpoint
DROP INDEX "CustomFieldGroup_modelType_idx";--> statement-breakpoint
DROP INDEX "CustomFieldGroup_name_organizationId_modelType_key";--> statement-breakpoint
DROP INDEX "CustomFieldGroup_organizationId_idx";--> statement-breakpoint
DROP INDEX "CustomFieldValue_entityId_fieldId_key";--> statement-breakpoint
DROP INDEX "CustomFieldValue_entityId_idx";--> statement-breakpoint
DROP INDEX "CustomFieldValue_fieldId_idx";--> statement-breakpoint
DROP INDEX "CustomField_modelType_idx";--> statement-breakpoint
DROP INDEX "CustomField_name_organizationId_key";--> statement-breakpoint
DROP INDEX "CustomField_organizationId_idx";--> statement-breakpoint
DROP INDEX "CustomerGroupMember_customerGroupId_contactId_key";--> statement-breakpoint
DROP INDEX "CustomerGroup_name_organizationId_key";--> statement-breakpoint
DROP INDEX "CustomerGroup_organizationId_idx";--> statement-breakpoint
DROP INDEX "CustomerSource_contactId_idx";--> statement-breakpoint
DROP INDEX "CustomerSource_email_idx";--> statement-breakpoint
DROP INDEX "CustomerSource_organizationId_idx";--> statement-breakpoint
DROP INDEX "CustomerSource_source_sourceId_organizationId_key";--> statement-breakpoint
DROP INDEX "DatasetMetadata_datasetId_idx";--> statement-breakpoint
DROP INDEX "DatasetMetadata_datasetId_name_key";--> statement-breakpoint
DROP INDEX "DatasetMetadata_type_idx";--> statement-breakpoint
DROP INDEX "DatasetSearchQuery_createdAt_idx";--> statement-breakpoint
DROP INDEX "DatasetSearchQuery_datasetId_idx";--> statement-breakpoint
DROP INDEX "DatasetSearchQuery_organizationId_idx";--> statement-breakpoint
DROP INDEX "DatasetSearchQuery_userId_idx";--> statement-breakpoint
DROP INDEX "DatasetSearchResult_queryId_idx";--> statement-breakpoint
DROP INDEX "DatasetSearchResult_queryId_segmentId_key";--> statement-breakpoint
DROP INDEX "DatasetSearchResult_rank_idx";--> statement-breakpoint
DROP INDEX "DatasetSearchResult_score_idx";--> statement-breakpoint
DROP INDEX "DatasetSearchResult_segmentId_idx";--> statement-breakpoint
DROP INDEX "Dataset_createdById_idx";--> statement-breakpoint
DROP INDEX "Dataset_organizationId_idx";--> statement-breakpoint
DROP INDEX "Dataset_organizationId_name_key";--> statement-breakpoint
DROP INDEX "Dataset_status_idx";--> statement-breakpoint
DROP INDEX "DocumentSegment_documentId_idx";--> statement-breakpoint
DROP INDEX "DocumentSegment_organizationId_idx";--> statement-breakpoint
DROP INDEX "DocumentSegment_position_idx";--> statement-breakpoint
DROP INDEX "idx_document_segment_active_embedding";--> statement-breakpoint
DROP INDEX "idx_document_segment_dataset_filter";--> statement-breakpoint
DROP INDEX "Document_checksum_idx";--> statement-breakpoint
DROP INDEX "Document_datasetId_checksum_key";--> statement-breakpoint
DROP INDEX "Document_datasetId_idx";--> statement-breakpoint
DROP INDEX "Document_enabled_idx";--> statement-breakpoint
DROP INDEX "Document_mediaAssetId_idx";--> statement-breakpoint
DROP INDEX "Document_organizationId_idx";--> statement-breakpoint
DROP INDEX "Document_status_idx";--> statement-breakpoint
DROP INDEX "Document_type_idx";--> statement-breakpoint
DROP INDEX "Document_uploadedById_idx";--> statement-breakpoint
DROP INDEX "EmailAddress_integrationId_address_key";--> statement-breakpoint
DROP INDEX "EmailAIAnalysis_isSpam_idx";--> statement-breakpoint
DROP INDEX "EmailAIAnalysis_messageId_key";--> statement-breakpoint
DROP INDEX "EmailAIAnalysis_needsResponse_idx";--> statement-breakpoint
DROP INDEX "EmailAIAnalysis_organizationId_idx";--> statement-breakpoint
DROP INDEX "EmailAttachment_mediaAssetId_idx";--> statement-breakpoint
DROP INDEX "EmailAttachment_messageId_idx";--> statement-breakpoint
DROP INDEX "EmailCategory_organizationId_name_key";--> statement-breakpoint
DROP INDEX "EmailContentAnalysis_messageId_idx";--> statement-breakpoint
DROP INDEX "EmailContentAnalysis_messageId_key";--> statement-breakpoint
DROP INDEX "EmailEmbedding_messageId_idx";--> statement-breakpoint
DROP INDEX "EmailKBArticleReference_messageId_articleId_key";--> statement-breakpoint
DROP INDEX "EmailOrderReference_messageId_orderNumber_key";--> statement-breakpoint
DROP INDEX "EmailProcessingJob_messageId_idx";--> statement-breakpoint
DROP INDEX "EmailProcessingJob_organizationId_idx";--> statement-breakpoint
DROP INDEX "EmailProcessingJob_organizationId_messageId_key";--> statement-breakpoint
DROP INDEX "EmailProcessingJob_status_createdAt_idx";--> statement-breakpoint
DROP INDEX "EmailProductReference_messageId_productId_key";--> statement-breakpoint
DROP INDEX "EmailResponse_messageId_idx";--> statement-breakpoint
DROP INDEX "EmailResponse_organizationId_idx";--> statement-breakpoint
DROP INDEX "EmailResponse_status_idx";--> statement-breakpoint
DROP INDEX "EmailRuleMatch_messageId_idx";--> statement-breakpoint
DROP INDEX "EmailRuleMatch_messageId_ruleId_key";--> statement-breakpoint
DROP INDEX "EmailRuleMatch_ruleId_idx";--> statement-breakpoint
DROP INDEX "EmailTemplate_organizationId_type_idx";--> statement-breakpoint
DROP INDEX "EmailTemplate_organizationId_type_isDefault_key";--> statement-breakpoint
DROP INDEX "embedding_jobs_collection_idx";--> statement-breakpoint
DROP INDEX "embedding_jobs_status_idx";--> statement-breakpoint
DROP INDEX "embeddings_collection_idx";--> statement-breakpoint
DROP INDEX "embeddings_documentId_idx";--> statement-breakpoint
DROP INDEX "embeddings_jobId_idx";--> statement-breakpoint
DROP INDEX "Event_organizationId_idx";--> statement-breakpoint
DROP INDEX "Event_type_idx";--> statement-breakpoint
DROP INDEX "ExecutedRuleGroup_executedAt_idx";--> statement-breakpoint
DROP INDEX "ExecutedRuleGroup_groupId_idx";--> statement-breakpoint
DROP INDEX "ExecutedRuleGroup_messageId_idx";--> statement-breakpoint
DROP INDEX "ExecutedRule_messageId_idx";--> statement-breakpoint
DROP INDEX "ExecutedRule_ruleId_idx";--> statement-breakpoint
DROP INDEX "ExecutedRule_threadId_idx";--> statement-breakpoint
DROP INDEX "ExternalKnowledgeSource_datasetId_idx";--> statement-breakpoint
DROP INDEX "ExternalKnowledgeSource_datasetId_name_key";--> statement-breakpoint
DROP INDEX "ExternalKnowledgeSource_nextSyncAt_idx";--> statement-breakpoint
DROP INDEX "ExternalKnowledgeSource_organizationId_idx";--> statement-breakpoint
DROP INDEX "ExternalKnowledgeSource_status_idx";--> statement-breakpoint
DROP INDEX "ExtractionTemplate_organizationId_idx";--> statement-breakpoint
DROP INDEX "FileAttachment_attachableId_attachableType_idx";--> statement-breakpoint
DROP INDEX "FileAttachment_fileId_attachableId_attachableType_key";--> statement-breakpoint
DROP INDEX "FileVersion_fileId_createdAt_idx";--> statement-breakpoint
DROP INDEX "FileVersion_fileId_versionNumber_key";--> statement-breakpoint
DROP INDEX "File_checksum_organizationId_idx";--> statement-breakpoint
DROP INDEX "File_hashedKey_key";--> statement-breakpoint
DROP INDEX "File_organizationId_status_idx";--> statement-breakpoint
DROP INDEX "File_status_expiresAt_idx";--> statement-breakpoint
DROP INDEX "File_visibility_hashedKey_idx";--> statement-breakpoint
DROP INDEX "FolderFile_currentVersionId_key";--> statement-breakpoint
DROP INDEX "FolderFile_organizationId_checksum_idx";--> statement-breakpoint
DROP INDEX "FolderFile_organizationId_deletedAt_isArchived_idx";--> statement-breakpoint
DROP INDEX "FolderFile_organizationId_ext_createdAt_idx";--> statement-breakpoint
DROP INDEX "FolderFile_organizationId_folderId_idx";--> statement-breakpoint
DROP INDEX "FolderFile_organizationId_folderId_path_idx";--> statement-breakpoint
DROP INDEX "FolderFile_organizationId_mimeType_updatedAt_idx";--> statement-breakpoint
DROP INDEX "FolderFile_organizationId_name_idx";--> statement-breakpoint
DROP INDEX "FolderFile_organizationId_path_idx";--> statement-breakpoint
DROP INDEX "FolderFile_organizationId_updatedAt_idx";--> statement-breakpoint
DROP INDEX "FolderFile_path_name_idx";--> statement-breakpoint
DROP INDEX "Folder_organizationId_deletedAt_isArchived_idx";--> statement-breakpoint
DROP INDEX "Folder_organizationId_depth_path_idx";--> statement-breakpoint
DROP INDEX "Folder_organizationId_parentId_idx";--> statement-breakpoint
DROP INDEX "Folder_organizationId_parentId_name_key";--> statement-breakpoint
DROP INDEX "Folder_parentId_name_idx";--> statement-breakpoint
DROP INDEX "FulfillmentTracking_fulfillmentId_idx";--> statement-breakpoint
DROP INDEX "FulfillmentTracking_number_idx";--> statement-breakpoint
DROP INDEX "FulfillmentTracking_number_key";--> statement-breakpoint
DROP INDEX "FulfillmentTracking_orderId_idx";--> statement-breakpoint
DROP INDEX "GroupMember_groupId_idx";--> statement-breakpoint
DROP INDEX "GroupMember_groupId_userId_key";--> statement-breakpoint
DROP INDEX "GroupMember_userId_idx";--> statement-breakpoint
DROP INDEX "Group_name_organizationId_key";--> statement-breakpoint
DROP INDEX "Group_organizationId_idx";--> statement-breakpoint
DROP INDEX "InboxGroupAccess_groupId_idx";--> statement-breakpoint
DROP INDEX "InboxGroupAccess_inboxId_groupId_key";--> statement-breakpoint
DROP INDEX "InboxGroupAccess_inboxId_idx";--> statement-breakpoint
DROP INDEX "InboxIntegration_inboxId_idx";--> statement-breakpoint
DROP INDEX "InboxIntegration_inboxId_integrationId_key";--> statement-breakpoint
DROP INDEX "InboxIntegration_integrationId_key";--> statement-breakpoint
DROP INDEX "InboxMemberAccess_inboxId_idx";--> statement-breakpoint
DROP INDEX "InboxMemberAccess_inboxId_organizationMemberId_key";--> statement-breakpoint
DROP INDEX "InboxMemberAccess_organizationMemberId_idx";--> statement-breakpoint
DROP INDEX "Inbox_organizationId_idx";--> statement-breakpoint
DROP INDEX "Inbox_organizationId_name_key";--> statement-breakpoint
DROP INDEX "MediaAsset_currentVersionId_key";--> statement-breakpoint
DROP INDEX "MediaAsset_expiresAt_idx";--> statement-breakpoint
DROP INDEX "MediaAsset_id_organizationId_key";--> statement-breakpoint
DROP INDEX "MediaAsset_kind_isPrivate_idx";--> statement-breakpoint
DROP INDEX "MediaAsset_organizationId_expiresAt_idx";--> statement-breakpoint
DROP INDEX "MediaAsset_organizationId_kind_idx";--> statement-breakpoint
DROP INDEX "MediaAsset_organizationId_purpose_kind_idx";--> statement-breakpoint
DROP INDEX "idx_thumbnail_assets";--> statement-breakpoint
DROP INDEX "MediaAssetVersion_assetId_createdAt_idx";--> statement-breakpoint
DROP INDEX "MediaAssetVersion_assetId_versionNumber_key";--> statement-breakpoint
DROP INDEX "MediaAssetVersion_derivedFromVersionId_preset_key";--> statement-breakpoint
DROP INDEX "MediaAssetVersion_derivedFromVersionId_preset_status_idx";--> statement-breakpoint
DROP INDEX "MediaAssetVersion_status_idx";--> statement-breakpoint
DROP INDEX "idx_thumbnail_cleanup";--> statement-breakpoint
DROP INDEX "idx_thumbnail_lookup_covering";--> statement-breakpoint
DROP INDEX "idx_unique_thumbnail";--> statement-breakpoint
DROP INDEX "Organization_handle_idx";--> statement-breakpoint
DROP INDEX "Organization_handle_key";--> statement-breakpoint
DROP INDEX "Organization_systemUserId_key";--> statement-breakpoint
DROP INDEX "OrganizationMember_organizationId_idx";--> statement-breakpoint
DROP INDEX "OrganizationMember_userId_idx";--> statement-breakpoint
DROP INDEX "OrganizationMember_userId_organizationId_key";--> statement-breakpoint
DROP INDEX "OrganizationInvitation_email_idx";--> statement-breakpoint
DROP INDEX "OrganizationInvitation_organizationId_idx";--> statement-breakpoint
DROP INDEX "OrganizationInvitation_status_idx";--> statement-breakpoint
DROP INDEX "OrganizationInvitation_token_key";--> statement-breakpoint
DROP INDEX "OrganizationSetting_key_idx";--> statement-breakpoint
DROP INDEX "OrganizationSetting_organizationId_idx";--> statement-breakpoint
DROP INDEX "OrganizationSetting_organizationId_key_key";--> statement-breakpoint
DROP INDEX "OrganizationSetting_scope_idx";--> statement-breakpoint
DROP INDEX "UserSetting_organizationSettingId_idx";--> statement-breakpoint
DROP INDEX "UserSetting_userId_idx";--> statement-breakpoint
DROP INDEX "UserSetting_userId_organizationSettingId_key";--> statement-breakpoint
DROP INDEX "IntegrationSchedule_integrationId_idx";--> statement-breakpoint
DROP INDEX "IntegrationSchedule_integrationId_key";--> statement-breakpoint
DROP INDEX "ShopifyIntegration_organizationId_idx";--> statement-breakpoint
DROP INDEX "ShopifyIntegration_organizationId_shopDomain_key";--> statement-breakpoint
DROP INDEX "ShopifyIntegration_shopDomain_idx";--> statement-breakpoint
DROP INDEX "ShopifyAuthState_state_idx";--> statement-breakpoint
DROP INDEX "ShopifyAuthState_userId_idx";--> statement-breakpoint
DROP INDEX "Participant_contactId_idx";--> statement-breakpoint
DROP INDEX "Participant_identifierType_idx";--> statement-breakpoint
DROP INDEX "Participant_identifier_idx";--> statement-breakpoint
DROP INDEX "Participant_organizationId_identifier_identifierType_key";--> statement-breakpoint
DROP INDEX "Participant_organizationId_idx";--> statement-breakpoint
DROP INDEX "VerificationToken_token_key";--> statement-breakpoint
DROP INDEX "VerificationToken_userId_idx";--> statement-breakpoint
DROP INDEX "PasswordResetToken_token_key";--> statement-breakpoint
DROP INDEX "PasswordResetToken_userId_idx";--> statement-breakpoint
DROP INDEX "ThreadReadStatus_isRead_idx";--> statement-breakpoint
DROP INDEX "ThreadReadStatus_organizationId_idx";--> statement-breakpoint
DROP INDEX "ThreadReadStatus_organizationId_userId_idx";--> statement-breakpoint
DROP INDEX "ThreadReadStatus_threadId_idx";--> statement-breakpoint
DROP INDEX "ThreadReadStatus_threadId_userId_key";--> statement-breakpoint
DROP INDEX "ThreadReadStatus_userId_idx";--> statement-breakpoint
DROP INDEX "ThreadReadStatus_userId_isRead_idx";--> statement-breakpoint
DROP INDEX "UserInboxUnreadCount_inboxId_idx";--> statement-breakpoint
DROP INDEX "UserInboxUnreadCount_organizationId_idx";--> statement-breakpoint
DROP INDEX "UserInboxUnreadCount_organizationId_inboxId_userId_key";--> statement-breakpoint
DROP INDEX "UserInboxUnreadCount_organizationId_userId_idx";--> statement-breakpoint
DROP INDEX "UserInboxUnreadCount_userId_idx";--> statement-breakpoint
DROP INDEX "Label_labelId_organizationId_integrationId_key";--> statement-breakpoint
DROP INDEX "Label_name_organizationId_integrationId_key";--> statement-breakpoint
DROP INDEX "Signature_createdById_idx";--> statement-breakpoint
DROP INDEX "Signature_isDefault_idx";--> statement-breakpoint
DROP INDEX "Signature_organizationId_idx";--> statement-breakpoint
DROP INDEX "Signature_sharingType_idx";--> statement-breakpoint
DROP INDEX "Message_createdById_idx";--> statement-breakpoint
DROP INDEX "Message_emailLabel_idx";--> statement-breakpoint
DROP INDEX "Message_fromId_idx";--> statement-breakpoint
DROP INDEX "Message_integrationId_externalId_key";--> statement-breakpoint
DROP INDEX "Message_integrationId_idx";--> statement-breakpoint
DROP INDEX "Message_organizationId_idx";--> statement-breakpoint
DROP INDEX "Message_organizationId_internetMessageId_key";--> statement-breakpoint
DROP INDEX "Message_replyToId_idx";--> statement-breakpoint
DROP INDEX "Message_sendToken_key";--> statement-breakpoint
DROP INDEX "Message_sentAt_idx";--> statement-breakpoint
DROP INDEX "Message_threadId_createdById_draftMode_idx";--> statement-breakpoint
DROP INDEX "Message_threadId_idx";--> statement-breakpoint
DROP INDEX "retry_queue_idx";--> statement-breakpoint
DROP INDEX "thread_messages_idx";--> statement-breakpoint
DROP INDEX "MessageParticipant_messageId_idx";--> statement-breakpoint
DROP INDEX "MessageParticipant_messageId_participantId_role_key";--> statement-breakpoint
DROP INDEX "MessageParticipant_participantId_idx";--> statement-breakpoint
DROP INDEX "MessageParticipant_role_idx";--> statement-breakpoint
DROP INDEX "contact_history_idx";--> statement-breakpoint
DROP INDEX "participant_lookup_idx";--> statement-breakpoint
DROP INDEX "Order_customerId_idx";--> statement-breakpoint
DROP INDEX "Order_name_idx";--> statement-breakpoint
DROP INDEX "Thread_inboxId_idx";--> statement-breakpoint
DROP INDEX "Thread_integrationId_externalId_key";--> statement-breakpoint
DROP INDEX "Thread_integrationId_idx";--> statement-breakpoint
DROP INDEX "Thread_lastMessageAt_idx";--> statement-breakpoint
DROP INDEX "Thread_organizationId_assigneeId_status_idx";--> statement-breakpoint
DROP INDEX "Thread_organizationId_createdAt_idx";--> statement-breakpoint
DROP INDEX "Thread_organizationId_idx";--> statement-breakpoint
DROP INDEX "Thread_organizationId_messageType_status_idx";--> statement-breakpoint
DROP INDEX "Thread_organizationId_status_idx";--> statement-breakpoint
DROP INDEX "Thread_status_idx";--> statement-breakpoint
DROP INDEX "thread_pagination_idx";--> statement-breakpoint
DROP INDEX "thread_participants_idx";--> statement-breakpoint
DROP INDEX "Product_handle_key";--> statement-breakpoint
DROP INDEX "Integration_organizationId_email_key";--> statement-breakpoint
DROP INDEX "Integration_organizationId_idx";--> statement-breakpoint
DROP INDEX "Integration_provider_organizationId_idx";--> statement-breakpoint
DROP INDEX "ResponseTemplate_organizationId_isActive_idx";--> statement-breakpoint
DROP INDEX "ResponseTemplate_organizationId_name_key";--> statement-breakpoint
DROP INDEX "ThreadAnalysis_organizationId_priority_idx";--> statement-breakpoint
DROP INDEX "ThreadAnalysis_organizationId_status_idx";--> statement-breakpoint
DROP INDEX "ThreadAnalysis_threadId_key";--> statement-breakpoint
DROP INDEX "ThreadParticipant_threadId_email_key";--> statement-breakpoint
DROP INDEX "ThreadTracker_organizationId_resolved_idx";--> statement-breakpoint
DROP INDEX "ThreadTracker_organizationId_resolved_sentAt_type_idx";--> statement-breakpoint
DROP INDEX "ThreadTracker_organizationId_threadId_messageId_key";--> statement-breakpoint
DROP INDEX "ThreadTracker_organizationId_type_resolved_sentAt_idx";--> statement-breakpoint
DROP INDEX "ProductVariant_productId_idx";--> statement-breakpoint
DROP INDEX "ProductMedia_productId_idx";--> statement-breakpoint
DROP INDEX "ProductOption_productId_idx";--> statement-breakpoint
DROP INDEX "shopify_customers_contactId_idx";--> statement-breakpoint
DROP INDEX "shopify_customers_defaultAddressId_key";--> statement-breakpoint
DROP INDEX "shopify_customers_email_idx";--> statement-breakpoint
DROP INDEX "shopify_customers_lastOrderId_key";--> statement-breakpoint
DROP INDEX "shopify_customers_phone_idx";--> statement-breakpoint
DROP INDEX "OrderRefund_orderId_idx";--> statement-breakpoint
DROP INDEX "OrderReturn_orderId_idx";--> statement-breakpoint
DROP INDEX "OrderLineItem_orderId_idx";--> statement-breakpoint
DROP INDEX "OrderFulfillment_orderId_idx";--> statement-breakpoint
DROP INDEX "OrderFulfillment_status_idx";--> statement-breakpoint
DROP INDEX "Subscription_provider_integrationId_topic_key";--> statement-breakpoint
DROP INDEX "WebhookEvent_integrationId_idx";--> statement-breakpoint
DROP INDEX "WebhookEvent_organizationId_idx";--> statement-breakpoint
DROP INDEX "Webhook_organizationId_idx";--> statement-breakpoint
DROP INDEX "WebhookDelivery_webhookId_idx";--> statement-breakpoint
DROP INDEX "Part_sku_key";--> statement-breakpoint
DROP INDEX "Subpart_parentPartId_childPartId_key";--> statement-breakpoint
DROP INDEX "VendorPart_partId_vendorId_key";--> statement-breakpoint
DROP INDEX "Inventory_partId_key";--> statement-breakpoint
DROP INDEX "TicketSequence_organizationId_key";--> statement-breakpoint
DROP INDEX "TicketReply_mailgunMessageId_key";--> statement-breakpoint
DROP INDEX "TicketReply_messageId_idx";--> statement-breakpoint
DROP INDEX "TicketReply_messageId_key";--> statement-breakpoint
DROP INDEX "TicketReply_ticketId_idx";--> statement-breakpoint
DROP INDEX "TicketRelation_ticketId_relatedTicketId_key";--> statement-breakpoint
DROP INDEX "Ticket_contactId_idx";--> statement-breakpoint
DROP INDEX "Ticket_emailThreadId_idx";--> statement-breakpoint
DROP INDEX "Ticket_mailgunMessageId_key";--> statement-breakpoint
DROP INDEX "Ticket_organizationId_idx";--> statement-breakpoint
DROP INDEX "Ticket_status_idx";--> statement-breakpoint
DROP INDEX "Ticket_type_idx";--> statement-breakpoint
DROP INDEX "KnowledgeBase_logoDarkId_key";--> statement-breakpoint
DROP INDEX "KnowledgeBase_logoLightId_key";--> statement-breakpoint
DROP INDEX "KnowledgeBase_organizationId_idx";--> statement-breakpoint
DROP INDEX "KnowledgeBase_organizationId_slug_key";--> statement-breakpoint
DROP INDEX "TicketNote_authorId_idx";--> statement-breakpoint
DROP INDEX "TicketNote_ticketId_idx";--> statement-breakpoint
DROP INDEX "TicketAssignment_ticketId_agentId_isActive_key";--> statement-breakpoint
DROP INDEX "User_avatarAssetId_key";--> statement-breakpoint
DROP INDEX "User_email_key";--> statement-breakpoint
DROP INDEX "MailDomain_organizationId_domain_key";--> statement-breakpoint
DROP INDEX "SnippetFolder_createdById_idx";--> statement-breakpoint
DROP INDEX "SnippetFolder_organizationId_idx";--> statement-breakpoint
DROP INDEX "SnippetFolder_organizationId_parentId_name_key";--> statement-breakpoint
DROP INDEX "Snippet_createdById_idx";--> statement-breakpoint
DROP INDEX "Snippet_folderId_idx";--> statement-breakpoint
DROP INDEX "Snippet_organizationId_idx";--> statement-breakpoint
DROP INDEX "Snippet_sharingType_idx";--> statement-breakpoint
DROP INDEX "SnippetShare_groupId_idx";--> statement-breakpoint
DROP INDEX "SnippetShare_memberId_idx";--> statement-breakpoint
DROP INDEX "SnippetShare_snippetId_groupId_memberId_key";--> statement-breakpoint
DROP INDEX "SnippetShare_snippetId_idx";--> statement-breakpoint
DROP INDEX "SignatureIntegrationShare_integrationId_idx";--> statement-breakpoint
DROP INDEX "SignatureIntegrationShare_signatureId_idx";--> statement-breakpoint
DROP INDEX "SignatureIntegrationShare_signatureId_integrationId_key";--> statement-breakpoint
DROP INDEX "MailView_isDefault_idx";--> statement-breakpoint
DROP INDEX "MailView_name_userId_organizationId_key";--> statement-breakpoint
DROP INDEX "MailView_organizationId_idx";--> statement-breakpoint
DROP INDEX "MailView_userId_idx";--> statement-breakpoint
DROP INDEX "OperatingHours_widgetId_dayOfWeek_key";--> statement-breakpoint
DROP INDEX "OperatingHours_widgetId_idx";--> statement-breakpoint
DROP INDEX "PlanSubscription_organizationId_key";--> statement-breakpoint
DROP INDEX "PlanSubscription_stripeCustomerId_key";--> statement-breakpoint
DROP INDEX "PaymentMethod_organizationId_idx";--> statement-breakpoint
DROP INDEX "Invoice_organizationId_idx";--> statement-breakpoint
DROP INDEX "Invoice_stripeInvoiceId_key";--> statement-breakpoint
DROP INDEX "Invoice_subscriptionId_idx";--> statement-breakpoint
DROP INDEX "Tag_organizationId_idx";--> statement-breakpoint
DROP INDEX "Tag_parentId_idx";--> statement-breakpoint
DROP INDEX "Tag_title_organizationId_parentId_key";--> statement-breakpoint
DROP INDEX "Notification_entityType_entityId_idx";--> statement-breakpoint
DROP INDEX "Notification_organizationId_idx";--> statement-breakpoint
DROP INDEX "Notification_userId_createdAt_idx";--> statement-breakpoint
DROP INDEX "Notification_userId_isRead_idx";--> statement-breakpoint
DROP INDEX "session_token_key";--> statement-breakpoint
DROP INDEX "TwoFactor_userId_key";--> statement-breakpoint
DROP INDEX "SyncJob_organizationId_integrationCategory_integrationId_idx";--> statement-breakpoint
DROP INDEX "SyncJob_organizationId_integrationCategory_status_idx";--> statement-breakpoint
DROP INDEX "SyncJob_organizationId_type_status_idx";--> statement-breakpoint
DROP INDEX "TableView_tableId_organizationId_idx";--> statement-breakpoint
DROP INDEX "TableView_tableId_organizationId_isDefault_key";--> statement-breakpoint
DROP INDEX "TableView_tableId_userId_idx";--> statement-breakpoint
DROP INDEX "TableView_tableId_userId_name_key";--> statement-breakpoint
DROP INDEX "RuleGroup_enabled_idx";--> statement-breakpoint
DROP INDEX "RuleGroup_organizationId_enabled_idx";--> statement-breakpoint
DROP INDEX "RuleGroup_organizationId_idx";--> statement-breakpoint
DROP INDEX "RuleGroupRule_groupId_idx";--> statement-breakpoint
DROP INDEX "RuleGroupRule_groupId_ruleId_key";--> statement-breakpoint
DROP INDEX "RuleGroupRule_ruleId_idx";--> statement-breakpoint
DROP INDEX "RuleGroupRelation_childId_idx";--> statement-breakpoint
DROP INDEX "RuleGroupRelation_parentId_childId_key";--> statement-breakpoint
DROP INDEX "RuleGroupRelation_parentId_idx";--> statement-breakpoint
DROP INDEX "TestCase_createdById_idx";--> statement-breakpoint
DROP INDEX "TestCase_organizationId_idx";--> statement-breakpoint
DROP INDEX "TestCase_status_idx";--> statement-breakpoint
DROP INDEX "TestSuite_organizationId_idx";--> statement-breakpoint
DROP INDEX "TestCaseInSuite_suiteId_idx";--> statement-breakpoint
DROP INDEX "TestCaseInSuite_suiteId_testCaseId_key";--> statement-breakpoint
DROP INDEX "TestCaseInSuite_testCaseId_idx";--> statement-breakpoint
DROP INDEX "RuleInSuite_ruleId_idx";--> statement-breakpoint
DROP INDEX "RuleInSuite_suiteId_idx";--> statement-breakpoint
DROP INDEX "RuleInSuite_suiteId_ruleId_key";--> statement-breakpoint
DROP INDEX "TestRun_organizationId_idx";--> statement-breakpoint
DROP INDEX "TestRun_startedAt_idx";--> statement-breakpoint
DROP INDEX "TestRun_status_idx";--> statement-breakpoint
DROP INDEX "TestRun_suiteId_idx";--> statement-breakpoint
DROP INDEX "TestResult_passed_idx";--> statement-breakpoint
DROP INDEX "TestResult_runId_idx";--> statement-breakpoint
DROP INDEX "TestResult_testCaseId_idx";--> statement-breakpoint
DROP INDEX "RuleAction_ruleId_idx";--> statement-breakpoint
DROP INDEX "RuleAction_ruleId_order_idx";--> statement-breakpoint
DROP INDEX "Rule_organizationId_enabled_idx";--> statement-breakpoint
DROP INDEX "Rule_organizationId_name_key";--> statement-breakpoint
DROP INDEX "Rule_organizationId_staticRuleType_idx";--> statement-breakpoint
DROP INDEX "Rule_organizationId_type_enabled_idx";--> statement-breakpoint
DROP INDEX "Rule_organizationId_type_idx";--> statement-breakpoint
DROP INDEX "ProposedAction_messageId_idx";--> statement-breakpoint
DROP INDEX "ProposedAction_organizationId_status_idx";--> statement-breakpoint
DROP INDEX "ProposedAction_ruleId_idx";--> statement-breakpoint
DROP INDEX "ProposedAction_status_createdAt_idx";--> statement-breakpoint
DROP INDEX "ShopifyAutomationMetrics_date_idx";--> statement-breakpoint
DROP INDEX "ShopifyAutomationMetrics_organizationId_date_key";--> statement-breakpoint
DROP INDEX "ShopifyAutomationRule_ruleId_idx";--> statement-breakpoint
DROP INDEX "ShopifyAutomationRule_ruleId_key";--> statement-breakpoint
DROP INDEX "IntegrationTagLabel_integrationId_idx";--> statement-breakpoint
DROP INDEX "IntegrationTagLabel_integrationId_labelId_key";--> statement-breakpoint
DROP INDEX "IntegrationTagLabel_integrationId_tagId_key";--> statement-breakpoint
DROP INDEX "IntegrationTagLabel_organizationId_idx";--> statement-breakpoint
DROP INDEX "SearchHistory_userId_organizationId_searchedAt_idx";--> statement-breakpoint
DROP INDEX "LoadBalancingConfig_organizationId_provider_model_idx";--> statement-breakpoint
DROP INDEX "LoadBalancingConfig_organizationId_provider_model_modelType_key";--> statement-breakpoint
DROP INDEX "ProviderPreference_organizationId_provider_idx";--> statement-breakpoint
DROP INDEX "ProviderPreference_organizationId_provider_key";--> statement-breakpoint
DROP INDEX "ModelConfiguration_organizationId_enabled_idx";--> statement-breakpoint
DROP INDEX "ModelConfiguration_organizationId_provider_idx";--> statement-breakpoint
DROP INDEX "ModelConfiguration_organizationId_provider_model_modelType_key";--> statement-breakpoint
DROP INDEX "Workflow_organizationId_enabled_idx";--> statement-breakpoint
DROP INDEX "Workflow_organizationId_triggerType_idx";--> statement-breakpoint
DROP INDEX "WorkflowApp_draftWorkflowId_key";--> statement-breakpoint
DROP INDEX "WorkflowApp_organizationId_enabled_idx";--> statement-breakpoint
DROP INDEX "WorkflowApp_organizationId_isPublic_idx";--> statement-breakpoint
DROP INDEX "WorkflowApp_workflowId_key";--> statement-breakpoint
DROP INDEX "ProviderConfiguration_organizationId_provider_idx";--> statement-breakpoint
DROP INDEX "ProviderConfiguration_organizationId_provider_key";--> statement-breakpoint
DROP INDEX "WorkflowRun_createdAt_idx";--> statement-breakpoint
DROP INDEX "WorkflowRun_organizationId_workflowAppId_idx";--> statement-breakpoint
DROP INDEX "WorkflowRun_resumeAt_idx";--> statement-breakpoint
DROP INDEX "WorkflowRun_status_idx";--> statement-breakpoint
DROP INDEX "WorkflowRun_workflowId_idx";--> statement-breakpoint
DROP INDEX "WorkflowNodeExecution_nodeId_idx";--> statement-breakpoint
DROP INDEX "WorkflowNodeExecution_status_idx";--> statement-breakpoint
DROP INDEX "WorkflowNodeExecution_workflowRunId_idx";--> statement-breakpoint
DROP INDEX "WorkflowJoinState_executionId_idx";--> statement-breakpoint
DROP INDEX "WorkflowJoinState_executionId_joinNodeId_key";--> statement-breakpoint
DROP INDEX "WorkflowJoinState_workflowId_idx";--> statement-breakpoint
DROP INDEX "WorkflowFile_expiresAt_idx";--> statement-breakpoint
DROP INDEX "WorkflowFile_nodeId_idx";--> statement-breakpoint
DROP INDEX "WorkflowFile_workflowId_fileId_key";--> statement-breakpoint
DROP INDEX "WorkflowFile_workflowId_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_createdById_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_organizationId_idx";--> statement-breakpoint
DROP INDEX "WorkflowCredentials_organizationId_type_idx";--> statement-breakpoint
DROP INDEX "StorageLocation_credentialId_idx";--> statement-breakpoint
DROP INDEX "StorageLocation_provider_externalId_idx";--> statement-breakpoint
DROP INDEX "UploadSession_organizationId_createdById_idx";--> statement-breakpoint
DROP INDEX "UploadSession_provider_externalId_idx";--> statement-breakpoint
ALTER TABLE "OrganizationSetting" ALTER COLUMN "value" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE INDEX "Address_customerId_idx" ON "Address" USING btree ("customerId");--> statement-breakpoint
CREATE INDEX "Address_orderId_idx" ON "Address" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "AiIntegration_organizationId_idx" ON "AiIntegration" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "AiIntegration_organizationId_isDefault_idx" ON "AiIntegration" USING btree ("organizationId","isDefault");--> statement-breakpoint
CREATE INDEX "AiIntegration_organizationId_modelType_idx" ON "AiIntegration" USING btree ("organizationId","modelType");--> statement-breakpoint
CREATE INDEX "AiIntegration_organizationId_providerType_idx" ON "AiIntegration" USING btree ("organizationId","providerType");--> statement-breakpoint
CREATE UNIQUE INDEX "AiIntegration_provider_organizationId_key" ON "AiIntegration" USING btree ("provider","organizationId");--> statement-breakpoint
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "AiUsage_organizationId_createdAt_idx" ON "AiUsage" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "AiUsage_provider_model_idx" ON "AiUsage" USING btree ("provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey" USING btree ("hashedKey");--> statement-breakpoint
CREATE INDEX "ApiKey_userId_isActive_idx" ON "ApiKey" USING btree ("userId","isActive");--> statement-breakpoint
CREATE INDEX "ApprovalRequest_createdById_idx" ON "ApprovalRequest" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "ApprovalRequest_organizationId_assigneeGroups_idx" ON "ApprovalRequest" USING btree ("organizationId","assigneeGroups");--> statement-breakpoint
CREATE INDEX "ApprovalRequest_organizationId_assigneeUsers_idx" ON "ApprovalRequest" USING btree ("organizationId","assigneeUsers");--> statement-breakpoint
CREATE INDEX "ApprovalRequest_organizationId_idx" ON "ApprovalRequest" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ApprovalRequest_status_expiresAt_idx" ON "ApprovalRequest" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE INDEX "ApprovalRequest_workflowRunId_idx" ON "ApprovalRequest" USING btree ("workflowRunId");--> statement-breakpoint
CREATE UNIQUE INDEX "ApprovalResponse_approvalRequestId_userId_key" ON "ApprovalResponse" USING btree ("approvalRequestId","userId");--> statement-breakpoint
CREATE INDEX "ApprovalResponse_userId_idx" ON "ApprovalResponse" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "ArticleTag_name_organizationId_key" ON "ArticleTag" USING btree ("name","organizationId");--> statement-breakpoint
CREATE INDEX "Article_isCategory_idx" ON "Article" USING btree ("isCategory");--> statement-breakpoint
CREATE INDEX "Article_knowledgeBaseId_idx" ON "Article" USING btree ("knowledgeBaseId");--> statement-breakpoint
CREATE UNIQUE INDEX "Article_knowledgeBaseId_slug_key" ON "Article" USING btree ("knowledgeBaseId","slug");--> statement-breakpoint
CREATE INDEX "Article_parentId_idx" ON "Article" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "Attachment_assetId_idx" ON "Attachment" USING btree ("assetId");--> statement-breakpoint
CREATE INDEX "Attachment_createdAt_idx" ON "Attachment" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "Attachment_entityType_entityId_idx" ON "Attachment" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "Attachment_fileId_idx" ON "Attachment" USING btree ("fileId");--> statement-breakpoint
CREATE UNIQUE INDEX "Attachment_id_organizationId_key" ON "Attachment" USING btree ("id","organizationId");--> statement-breakpoint
CREATE INDEX "Attachment_organizationId_entityType_entityId_idx" ON "Attachment" USING btree ("organizationId","entityType","entityId");--> statement-breakpoint
CREATE INDEX "AutoResponseRule_organizationId_isActive_idx" ON "AutoResponseRule" USING btree ("organizationId","isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "AutoResponseRule_organizationId_name_key" ON "AutoResponseRule" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX "AutoResponseRule_priority_idx" ON "AutoResponseRule" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "ChatAttachment_sessionId_idx" ON "ChatAttachment" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "ChatMessage_agentId_idx" ON "ChatMessage" USING btree ("agentId");--> statement-breakpoint
CREATE INDEX "ChatMessage_createdAt_idx" ON "ChatMessage" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage" USING btree ("sessionId");--> statement-breakpoint
CREATE INDEX "ChatMessage_threadId_idx" ON "ChatMessage" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX "ChatSession_lastActivityAt_idx" ON "ChatSession" USING btree ("lastActivityAt");--> statement-breakpoint
CREATE INDEX "ChatSession_organizationId_idx" ON "ChatSession" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ChatSession_status_idx" ON "ChatSession" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ChatSession_visitorId_idx" ON "ChatSession" USING btree ("visitorId");--> statement-breakpoint
CREATE INDEX "ChatSession_widgetId_idx" ON "ChatSession" USING btree ("widgetId");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatWidget_integrationId_key" ON "ChatWidget" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX "ChatWidget_organizationId_idx" ON "ChatWidget" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "ChatWidget_organizationId_name_key" ON "ChatWidget" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX "CommentMention_commentId_idx" ON "CommentMention" USING btree ("commentId");--> statement-breakpoint
CREATE UNIQUE INDEX "CommentMention_commentId_userId_key" ON "CommentMention" USING btree ("commentId","userId");--> statement-breakpoint
CREATE INDEX "CommentMention_userId_idx" ON "CommentMention" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "CommentReaction_commentId_idx" ON "CommentReaction" USING btree ("commentId");--> statement-breakpoint
CREATE UNIQUE INDEX "CommentReaction_commentId_userId_type_emoji_key" ON "CommentReaction" USING btree ("commentId","userId","type","emoji");--> statement-breakpoint
CREATE INDEX "CommentReaction_type_idx" ON "CommentReaction" USING btree ("type");--> statement-breakpoint
CREATE INDEX "CommentReaction_userId_idx" ON "CommentReaction" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Comment_createdById_idx" ON "Comment" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Comment_deletedAt_idx" ON "Comment" USING btree ("deletedAt");--> statement-breakpoint
CREATE INDEX "Comment_entityId_entityType_idx" ON "Comment" USING btree ("entityId","entityType");--> statement-breakpoint
CREATE INDEX "Comment_isPinned_idx" ON "Comment" USING btree ("isPinned");--> statement-breakpoint
CREATE INDEX "Comment_organizationId_idx" ON "Comment" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Comment_parentId_idx" ON "Comment" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "Comment_threadId_idx" ON "Comment" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX "Comment_ticketId_idx" ON "Comment" USING btree ("ticketId");--> statement-breakpoint
CREATE INDEX "Contact_emails_idx" ON "Contact" USING gin ("emails");--> statement-breakpoint
CREATE UNIQUE INDEX "Contact_organizationId_email_key" ON "Contact" USING btree ("organizationId","email");--> statement-breakpoint
CREATE INDEX "Contact_organizationId_idx" ON "Contact" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Contact_organizationId_phone_idx" ON "Contact" USING btree ("organizationId","phone");--> statement-breakpoint
CREATE INDEX "Contact_organizationId_status_idx" ON "Contact" USING btree ("organizationId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomExtractionRule_organizationId_entityType_templateId_key" ON "CustomExtractionRule" USING btree ("organizationId","entityType","templateId");--> statement-breakpoint
CREATE INDEX "CustomExtractionRule_organizationId_isActive_idx" ON "CustomExtractionRule" USING btree ("organizationId","isActive");--> statement-breakpoint
CREATE INDEX "CustomExtractionRule_templateId_idx" ON "CustomExtractionRule" USING btree ("templateId");--> statement-breakpoint
CREATE INDEX "CustomFieldGroup_modelType_idx" ON "CustomFieldGroup" USING btree ("modelType");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomFieldGroup_name_organizationId_modelType_key" ON "CustomFieldGroup" USING btree ("name","organizationId","modelType");--> statement-breakpoint
CREATE INDEX "CustomFieldGroup_organizationId_idx" ON "CustomFieldGroup" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomFieldValue_entityId_fieldId_key" ON "CustomFieldValue" USING btree ("entityId","fieldId");--> statement-breakpoint
CREATE INDEX "CustomFieldValue_entityId_idx" ON "CustomFieldValue" USING btree ("entityId");--> statement-breakpoint
CREATE INDEX "CustomFieldValue_fieldId_idx" ON "CustomFieldValue" USING btree ("fieldId");--> statement-breakpoint
CREATE INDEX "CustomField_modelType_idx" ON "CustomField" USING btree ("modelType");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomField_name_organizationId_key" ON "CustomField" USING btree ("name","organizationId");--> statement-breakpoint
CREATE INDEX "CustomField_organizationId_idx" ON "CustomField" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomerGroupMember_customerGroupId_contactId_key" ON "CustomerGroupMember" USING btree ("customerGroupId","contactId");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomerGroup_name_organizationId_key" ON "CustomerGroup" USING btree ("name","organizationId");--> statement-breakpoint
CREATE INDEX "CustomerGroup_organizationId_idx" ON "CustomerGroup" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "CustomerSource_contactId_idx" ON "CustomerSource" USING btree ("contactId");--> statement-breakpoint
CREATE INDEX "CustomerSource_email_idx" ON "CustomerSource" USING btree ("email");--> statement-breakpoint
CREATE INDEX "CustomerSource_organizationId_idx" ON "CustomerSource" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "CustomerSource_source_sourceId_organizationId_key" ON "CustomerSource" USING btree ("source","sourceId","organizationId");--> statement-breakpoint
CREATE INDEX "DatasetMetadata_datasetId_idx" ON "DatasetMetadata" USING btree ("datasetId");--> statement-breakpoint
CREATE UNIQUE INDEX "DatasetMetadata_datasetId_name_key" ON "DatasetMetadata" USING btree ("datasetId","name");--> statement-breakpoint
CREATE INDEX "DatasetMetadata_type_idx" ON "DatasetMetadata" USING btree ("type");--> statement-breakpoint
CREATE INDEX "DatasetSearchQuery_createdAt_idx" ON "DatasetSearchQuery" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "DatasetSearchQuery_datasetId_idx" ON "DatasetSearchQuery" USING btree ("datasetId");--> statement-breakpoint
CREATE INDEX "DatasetSearchQuery_organizationId_idx" ON "DatasetSearchQuery" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "DatasetSearchQuery_userId_idx" ON "DatasetSearchQuery" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "DatasetSearchResult_queryId_idx" ON "DatasetSearchResult" USING btree ("queryId");--> statement-breakpoint
CREATE UNIQUE INDEX "DatasetSearchResult_queryId_segmentId_key" ON "DatasetSearchResult" USING btree ("queryId","segmentId");--> statement-breakpoint
CREATE INDEX "DatasetSearchResult_rank_idx" ON "DatasetSearchResult" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "DatasetSearchResult_score_idx" ON "DatasetSearchResult" USING btree ("score");--> statement-breakpoint
CREATE INDEX "DatasetSearchResult_segmentId_idx" ON "DatasetSearchResult" USING btree ("segmentId");--> statement-breakpoint
CREATE INDEX "Dataset_createdById_idx" ON "Dataset" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Dataset_organizationId_idx" ON "Dataset" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "Dataset_organizationId_name_key" ON "Dataset" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX "Dataset_status_idx" ON "Dataset" USING btree ("status");--> statement-breakpoint
CREATE INDEX "DocumentSegment_documentId_idx" ON "DocumentSegment" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "DocumentSegment_organizationId_idx" ON "DocumentSegment" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "DocumentSegment_position_idx" ON "DocumentSegment" USING btree ("position");--> statement-breakpoint
CREATE INDEX "idx_document_segment_active_embedding" ON "DocumentSegment" USING hnsw ("embedding" vector_l2_ops) WITH (m=16,ef_construction=64) WHERE ((enabled = true) AND ("indexStatus" = 'INDEXED'::"IndexStatus") AND (embedding IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_document_segment_dataset_filter" ON "DocumentSegment" USING btree ("documentId") WHERE ((enabled = true) AND ("indexStatus" = 'INDEXED'::"IndexStatus") AND (embedding IS NOT NULL));--> statement-breakpoint
CREATE INDEX "Document_checksum_idx" ON "Document" USING btree ("checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "Document_datasetId_checksum_key" ON "Document" USING btree ("datasetId","checksum");--> statement-breakpoint
CREATE INDEX "Document_datasetId_idx" ON "Document" USING btree ("datasetId");--> statement-breakpoint
CREATE INDEX "Document_enabled_idx" ON "Document" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "Document_mediaAssetId_idx" ON "Document" USING btree ("mediaAssetId");--> statement-breakpoint
CREATE INDEX "Document_organizationId_idx" ON "Document" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Document_status_idx" ON "Document" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Document_type_idx" ON "Document" USING btree ("type");--> statement-breakpoint
CREATE INDEX "Document_uploadedById_idx" ON "Document" USING btree ("uploadedById");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailAddress_integrationId_address_key" ON "EmailAddress" USING btree ("integrationId","address");--> statement-breakpoint
CREATE INDEX "EmailAIAnalysis_isSpam_idx" ON "EmailAIAnalysis" USING btree ("isSpam");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailAIAnalysis_messageId_key" ON "EmailAIAnalysis" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "EmailAIAnalysis_needsResponse_idx" ON "EmailAIAnalysis" USING btree ("needsResponse");--> statement-breakpoint
CREATE INDEX "EmailAIAnalysis_organizationId_idx" ON "EmailAIAnalysis" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "EmailAttachment_mediaAssetId_idx" ON "EmailAttachment" USING btree ("mediaAssetId");--> statement-breakpoint
CREATE INDEX "EmailAttachment_messageId_idx" ON "EmailAttachment" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailCategory_organizationId_name_key" ON "EmailCategory" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX "EmailContentAnalysis_messageId_idx" ON "EmailContentAnalysis" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailContentAnalysis_messageId_key" ON "EmailContentAnalysis" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "EmailEmbedding_messageId_idx" ON "EmailEmbedding" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailKBArticleReference_messageId_articleId_key" ON "EmailKBArticleReference" USING btree ("messageId","articleId");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailOrderReference_messageId_orderNumber_key" ON "EmailOrderReference" USING btree ("messageId","orderNumber");--> statement-breakpoint
CREATE INDEX "EmailProcessingJob_messageId_idx" ON "EmailProcessingJob" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "EmailProcessingJob_organizationId_idx" ON "EmailProcessingJob" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailProcessingJob_organizationId_messageId_key" ON "EmailProcessingJob" USING btree ("organizationId","messageId");--> statement-breakpoint
CREATE INDEX "EmailProcessingJob_status_createdAt_idx" ON "EmailProcessingJob" USING btree ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailProductReference_messageId_productId_key" ON "EmailProductReference" USING btree ("messageId","productId");--> statement-breakpoint
CREATE INDEX "EmailResponse_messageId_idx" ON "EmailResponse" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "EmailResponse_organizationId_idx" ON "EmailResponse" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "EmailResponse_status_idx" ON "EmailResponse" USING btree ("status");--> statement-breakpoint
CREATE INDEX "EmailRuleMatch_messageId_idx" ON "EmailRuleMatch" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailRuleMatch_messageId_ruleId_key" ON "EmailRuleMatch" USING btree ("messageId","ruleId");--> statement-breakpoint
CREATE INDEX "EmailRuleMatch_ruleId_idx" ON "EmailRuleMatch" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX "EmailTemplate_organizationId_type_idx" ON "EmailTemplate" USING btree ("organizationId","type");--> statement-breakpoint
CREATE UNIQUE INDEX "EmailTemplate_organizationId_type_isDefault_key" ON "EmailTemplate" USING btree ("organizationId","type","isDefault");--> statement-breakpoint
CREATE INDEX "embedding_jobs_collection_idx" ON "embedding_jobs" USING btree ("collection");--> statement-breakpoint
CREATE INDEX "embedding_jobs_status_idx" ON "embedding_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "embeddings_collection_idx" ON "embeddings" USING btree ("collection");--> statement-breakpoint
CREATE INDEX "embeddings_documentId_idx" ON "embeddings" USING btree ("documentId");--> statement-breakpoint
CREATE INDEX "embeddings_jobId_idx" ON "embeddings" USING btree ("jobId");--> statement-breakpoint
CREATE INDEX "Event_organizationId_idx" ON "Event" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Event_type_idx" ON "Event" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ExecutedRuleGroup_executedAt_idx" ON "ExecutedRuleGroup" USING btree ("executedAt");--> statement-breakpoint
CREATE INDEX "ExecutedRuleGroup_groupId_idx" ON "ExecutedRuleGroup" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "ExecutedRuleGroup_messageId_idx" ON "ExecutedRuleGroup" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "ExecutedRule_messageId_idx" ON "ExecutedRule" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "ExecutedRule_ruleId_idx" ON "ExecutedRule" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX "ExecutedRule_threadId_idx" ON "ExecutedRule" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX "ExternalKnowledgeSource_datasetId_idx" ON "ExternalKnowledgeSource" USING btree ("datasetId");--> statement-breakpoint
CREATE UNIQUE INDEX "ExternalKnowledgeSource_datasetId_name_key" ON "ExternalKnowledgeSource" USING btree ("datasetId","name");--> statement-breakpoint
CREATE INDEX "ExternalKnowledgeSource_nextSyncAt_idx" ON "ExternalKnowledgeSource" USING btree ("nextSyncAt");--> statement-breakpoint
CREATE INDEX "ExternalKnowledgeSource_organizationId_idx" ON "ExternalKnowledgeSource" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ExternalKnowledgeSource_status_idx" ON "ExternalKnowledgeSource" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ExtractionTemplate_organizationId_idx" ON "ExtractionTemplate" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "FileAttachment_attachableId_attachableType_idx" ON "FileAttachment" USING btree ("attachableId","attachableType");--> statement-breakpoint
CREATE UNIQUE INDEX "FileAttachment_fileId_attachableId_attachableType_key" ON "FileAttachment" USING btree ("fileId","attachableId","attachableType");--> statement-breakpoint
CREATE INDEX "FileVersion_fileId_createdAt_idx" ON "FileVersion" USING btree ("fileId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "FileVersion_fileId_versionNumber_key" ON "FileVersion" USING btree ("fileId","versionNumber");--> statement-breakpoint
CREATE INDEX "File_checksum_organizationId_idx" ON "File" USING btree ("checksum","organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "File_hashedKey_key" ON "File" USING btree ("hashedKey");--> statement-breakpoint
CREATE INDEX "File_organizationId_status_idx" ON "File" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "File_status_expiresAt_idx" ON "File" USING btree ("status","expiresAt");--> statement-breakpoint
CREATE INDEX "File_visibility_hashedKey_idx" ON "File" USING btree ("visibility","hashedKey");--> statement-breakpoint
CREATE UNIQUE INDEX "FolderFile_currentVersionId_key" ON "FolderFile" USING btree ("currentVersionId");--> statement-breakpoint
CREATE INDEX "FolderFile_organizationId_checksum_idx" ON "FolderFile" USING btree ("organizationId","checksum");--> statement-breakpoint
CREATE INDEX "FolderFile_organizationId_deletedAt_isArchived_idx" ON "FolderFile" USING btree ("organizationId","deletedAt","isArchived");--> statement-breakpoint
CREATE INDEX "FolderFile_organizationId_ext_createdAt_idx" ON "FolderFile" USING btree ("organizationId","ext","createdAt");--> statement-breakpoint
CREATE INDEX "FolderFile_organizationId_folderId_idx" ON "FolderFile" USING btree ("organizationId","folderId");--> statement-breakpoint
CREATE INDEX "FolderFile_organizationId_folderId_path_idx" ON "FolderFile" USING btree ("organizationId","folderId","path");--> statement-breakpoint
CREATE INDEX "FolderFile_organizationId_mimeType_updatedAt_idx" ON "FolderFile" USING btree ("organizationId","mimeType","updatedAt");--> statement-breakpoint
CREATE INDEX "FolderFile_organizationId_name_idx" ON "FolderFile" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX "FolderFile_organizationId_path_idx" ON "FolderFile" USING btree ("organizationId","path");--> statement-breakpoint
CREATE INDEX "FolderFile_organizationId_updatedAt_idx" ON "FolderFile" USING btree ("organizationId","updatedAt");--> statement-breakpoint
CREATE INDEX "FolderFile_path_name_idx" ON "FolderFile" USING btree ("path","name");--> statement-breakpoint
CREATE INDEX "Folder_organizationId_deletedAt_isArchived_idx" ON "Folder" USING btree ("organizationId","deletedAt","isArchived");--> statement-breakpoint
CREATE INDEX "Folder_organizationId_depth_path_idx" ON "Folder" USING btree ("organizationId","depth","path");--> statement-breakpoint
CREATE INDEX "Folder_organizationId_parentId_idx" ON "Folder" USING btree ("organizationId","parentId");--> statement-breakpoint
CREATE UNIQUE INDEX "Folder_organizationId_parentId_name_key" ON "Folder" USING btree ("organizationId","parentId","name");--> statement-breakpoint
CREATE INDEX "Folder_parentId_name_idx" ON "Folder" USING btree ("parentId","name");--> statement-breakpoint
CREATE INDEX "FulfillmentTracking_fulfillmentId_idx" ON "FulfillmentTracking" USING btree ("fulfillmentId");--> statement-breakpoint
CREATE INDEX "FulfillmentTracking_number_idx" ON "FulfillmentTracking" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "FulfillmentTracking_number_key" ON "FulfillmentTracking" USING btree ("number");--> statement-breakpoint
CREATE INDEX "FulfillmentTracking_orderId_idx" ON "FulfillmentTracking" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "GroupMember_groupId_idx" ON "GroupMember" USING btree ("groupId");--> statement-breakpoint
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember" USING btree ("groupId","userId");--> statement-breakpoint
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "Group_name_organizationId_key" ON "Group" USING btree ("name","organizationId");--> statement-breakpoint
CREATE INDEX "Group_organizationId_idx" ON "Group" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "InboxGroupAccess_groupId_idx" ON "InboxGroupAccess" USING btree ("groupId");--> statement-breakpoint
CREATE UNIQUE INDEX "InboxGroupAccess_inboxId_groupId_key" ON "InboxGroupAccess" USING btree ("inboxId","groupId");--> statement-breakpoint
CREATE INDEX "InboxGroupAccess_inboxId_idx" ON "InboxGroupAccess" USING btree ("inboxId");--> statement-breakpoint
CREATE INDEX "InboxIntegration_inboxId_idx" ON "InboxIntegration" USING btree ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX "InboxIntegration_inboxId_integrationId_key" ON "InboxIntegration" USING btree ("inboxId","integrationId");--> statement-breakpoint
CREATE UNIQUE INDEX "InboxIntegration_integrationId_key" ON "InboxIntegration" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX "InboxMemberAccess_inboxId_idx" ON "InboxMemberAccess" USING btree ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX "InboxMemberAccess_inboxId_organizationMemberId_key" ON "InboxMemberAccess" USING btree ("inboxId","organizationMemberId");--> statement-breakpoint
CREATE INDEX "InboxMemberAccess_organizationMemberId_idx" ON "InboxMemberAccess" USING btree ("organizationMemberId");--> statement-breakpoint
CREATE INDEX "Inbox_organizationId_idx" ON "Inbox" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "Inbox_organizationId_name_key" ON "Inbox" USING btree ("organizationId","name");--> statement-breakpoint
CREATE UNIQUE INDEX "MediaAsset_currentVersionId_key" ON "MediaAsset" USING btree ("currentVersionId");--> statement-breakpoint
CREATE INDEX "MediaAsset_expiresAt_idx" ON "MediaAsset" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "MediaAsset_id_organizationId_key" ON "MediaAsset" USING btree ("id","organizationId");--> statement-breakpoint
CREATE INDEX "MediaAsset_kind_isPrivate_idx" ON "MediaAsset" USING btree ("kind","isPrivate");--> statement-breakpoint
CREATE INDEX "MediaAsset_organizationId_expiresAt_idx" ON "MediaAsset" USING btree ("organizationId","expiresAt");--> statement-breakpoint
CREATE INDEX "MediaAsset_organizationId_kind_idx" ON "MediaAsset" USING btree ("organizationId","kind");--> statement-breakpoint
CREATE INDEX "MediaAsset_organizationId_purpose_kind_idx" ON "MediaAsset" USING btree ("organizationId","purpose","kind");--> statement-breakpoint
CREATE INDEX "idx_thumbnail_assets" ON "MediaAsset" USING btree ("organizationId","kind") WHERE ((kind = 'THUMBNAIL'::text) AND ("deletedAt" IS NULL));--> statement-breakpoint
CREATE INDEX "MediaAssetVersion_assetId_createdAt_idx" ON "MediaAssetVersion" USING btree ("assetId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "MediaAssetVersion_assetId_versionNumber_key" ON "MediaAssetVersion" USING btree ("assetId","versionNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "MediaAssetVersion_derivedFromVersionId_preset_key" ON "MediaAssetVersion" USING btree ("derivedFromVersionId","preset");--> statement-breakpoint
CREATE INDEX "MediaAssetVersion_derivedFromVersionId_preset_status_idx" ON "MediaAssetVersion" USING btree ("derivedFromVersionId","preset","status");--> statement-breakpoint
CREATE INDEX "MediaAssetVersion_status_idx" ON "MediaAssetVersion" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_thumbnail_cleanup" ON "MediaAssetVersion" USING btree ("derivedFromVersionId") WHERE (("derivedFromVersionId" IS NOT NULL) AND ("deletedAt" IS NULL));--> statement-breakpoint
CREATE INDEX "idx_thumbnail_lookup_covering" ON "MediaAssetVersion" USING btree ("derivedFromVersionId","preset","id") WHERE (("derivedFromVersionId" IS NOT NULL) AND ("deletedAt" IS NULL));--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_thumbnail" ON "MediaAssetVersion" USING btree ("derivedFromVersionId","preset") WHERE (("derivedFromVersionId" IS NOT NULL) AND ("deletedAt" IS NULL));--> statement-breakpoint
CREATE INDEX "Organization_handle_idx" ON "Organization" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "Organization_handle_key" ON "Organization" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "Organization_systemUserId_key" ON "Organization" USING btree ("systemUserId");--> statement-breakpoint
CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "OrganizationMember_userId_organizationId_key" ON "OrganizationMember" USING btree ("userId","organizationId");--> statement-breakpoint
CREATE INDEX "OrganizationInvitation_email_idx" ON "OrganizationInvitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "OrganizationInvitation_organizationId_idx" ON "OrganizationInvitation" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "OrganizationInvitation_status_idx" ON "OrganizationInvitation" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "OrganizationInvitation_token_key" ON "OrganizationInvitation" USING btree ("token");--> statement-breakpoint
CREATE INDEX "OrganizationSetting_key_idx" ON "OrganizationSetting" USING btree ("key");--> statement-breakpoint
CREATE INDEX "OrganizationSetting_organizationId_idx" ON "OrganizationSetting" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "OrganizationSetting_organizationId_key_key" ON "OrganizationSetting" USING btree ("organizationId","key");--> statement-breakpoint
CREATE INDEX "OrganizationSetting_scope_idx" ON "OrganizationSetting" USING btree ("scope");--> statement-breakpoint
CREATE INDEX "UserSetting_organizationSettingId_idx" ON "UserSetting" USING btree ("organizationSettingId");--> statement-breakpoint
CREATE INDEX "UserSetting_userId_idx" ON "UserSetting" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "UserSetting_userId_organizationSettingId_key" ON "UserSetting" USING btree ("userId","organizationSettingId");--> statement-breakpoint
CREATE INDEX "IntegrationSchedule_integrationId_idx" ON "IntegrationSchedule" USING btree ("integrationId");--> statement-breakpoint
CREATE UNIQUE INDEX "IntegrationSchedule_integrationId_key" ON "IntegrationSchedule" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX "ShopifyIntegration_organizationId_idx" ON "ShopifyIntegration" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "ShopifyIntegration_organizationId_shopDomain_key" ON "ShopifyIntegration" USING btree ("organizationId","shopDomain");--> statement-breakpoint
CREATE INDEX "ShopifyIntegration_shopDomain_idx" ON "ShopifyIntegration" USING btree ("shopDomain");--> statement-breakpoint
CREATE INDEX "ShopifyAuthState_state_idx" ON "ShopifyAuthState" USING btree ("state");--> statement-breakpoint
CREATE INDEX "ShopifyAuthState_userId_idx" ON "ShopifyAuthState" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Participant_contactId_idx" ON "Participant" USING btree ("contactId");--> statement-breakpoint
CREATE INDEX "Participant_identifierType_idx" ON "Participant" USING btree ("identifierType");--> statement-breakpoint
CREATE INDEX "Participant_identifier_idx" ON "Participant" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "Participant_organizationId_identifier_identifierType_key" ON "Participant" USING btree ("organizationId","identifier","identifierType");--> statement-breakpoint
CREATE INDEX "Participant_organizationId_idx" ON "Participant" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken" USING btree ("token");--> statement-breakpoint
CREATE INDEX "VerificationToken_userId_idx" ON "VerificationToken" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken" USING btree ("token");--> statement-breakpoint
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ThreadReadStatus_isRead_idx" ON "ThreadReadStatus" USING btree ("isRead");--> statement-breakpoint
CREATE INDEX "ThreadReadStatus_organizationId_idx" ON "ThreadReadStatus" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "ThreadReadStatus_organizationId_userId_idx" ON "ThreadReadStatus" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX "ThreadReadStatus_threadId_idx" ON "ThreadReadStatus" USING btree ("threadId");--> statement-breakpoint
CREATE UNIQUE INDEX "ThreadReadStatus_threadId_userId_key" ON "ThreadReadStatus" USING btree ("threadId","userId");--> statement-breakpoint
CREATE INDEX "ThreadReadStatus_userId_idx" ON "ThreadReadStatus" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ThreadReadStatus_userId_isRead_idx" ON "ThreadReadStatus" USING btree ("userId","isRead");--> statement-breakpoint
CREATE INDEX "UserInboxUnreadCount_inboxId_idx" ON "UserInboxUnreadCount" USING btree ("inboxId");--> statement-breakpoint
CREATE INDEX "UserInboxUnreadCount_organizationId_idx" ON "UserInboxUnreadCount" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "UserInboxUnreadCount_organizationId_inboxId_userId_key" ON "UserInboxUnreadCount" USING btree ("organizationId","inboxId","userId");--> statement-breakpoint
CREATE INDEX "UserInboxUnreadCount_organizationId_userId_idx" ON "UserInboxUnreadCount" USING btree ("organizationId","userId");--> statement-breakpoint
CREATE INDEX "UserInboxUnreadCount_userId_idx" ON "UserInboxUnreadCount" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "Label_labelId_organizationId_integrationId_key" ON "Label" USING btree ("labelId","organizationId","integrationId");--> statement-breakpoint
CREATE UNIQUE INDEX "Label_name_organizationId_integrationId_key" ON "Label" USING btree ("name","organizationId","integrationId");--> statement-breakpoint
CREATE INDEX "Signature_createdById_idx" ON "Signature" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Signature_isDefault_idx" ON "Signature" USING btree ("isDefault");--> statement-breakpoint
CREATE INDEX "Signature_organizationId_idx" ON "Signature" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Signature_sharingType_idx" ON "Signature" USING btree ("sharingType");--> statement-breakpoint
CREATE INDEX "Message_createdById_idx" ON "Message" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Message_emailLabel_idx" ON "Message" USING btree ("emailLabel");--> statement-breakpoint
CREATE INDEX "Message_fromId_idx" ON "Message" USING btree ("fromId");--> statement-breakpoint
CREATE UNIQUE INDEX "Message_integrationId_externalId_key" ON "Message" USING btree ("integrationId","externalId");--> statement-breakpoint
CREATE INDEX "Message_integrationId_idx" ON "Message" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX "Message_organizationId_idx" ON "Message" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "Message_organizationId_internetMessageId_key" ON "Message" USING btree ("organizationId","internetMessageId") WHERE ("internetMessageId" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "Message_replyToId_idx" ON "Message" USING btree ("replyToId");--> statement-breakpoint
CREATE UNIQUE INDEX "Message_sendToken_key" ON "Message" USING btree ("sendToken") WHERE ("sendToken" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "Message_sentAt_idx" ON "Message" USING btree ("sentAt");--> statement-breakpoint
CREATE INDEX "Message_threadId_createdById_draftMode_idx" ON "Message" USING btree ("threadId","createdById","draftMode");--> statement-breakpoint
CREATE INDEX "Message_threadId_idx" ON "Message" USING btree ("threadId");--> statement-breakpoint
CREATE INDEX "retry_queue_idx" ON "Message" USING btree ("organizationId","sendStatus","lastAttemptAt");--> statement-breakpoint
CREATE INDEX "thread_messages_idx" ON "Message" USING btree ("threadId","draftMode","sentAt");--> statement-breakpoint
CREATE INDEX "MessageParticipant_messageId_idx" ON "MessageParticipant" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX "MessageParticipant_messageId_participantId_role_key" ON "MessageParticipant" USING btree ("messageId","participantId","role");--> statement-breakpoint
CREATE INDEX "MessageParticipant_participantId_idx" ON "MessageParticipant" USING btree ("participantId");--> statement-breakpoint
CREATE INDEX "MessageParticipant_role_idx" ON "MessageParticipant" USING btree ("role");--> statement-breakpoint
CREATE INDEX "contact_history_idx" ON "MessageParticipant" USING btree ("contactId","createdAt");--> statement-breakpoint
CREATE INDEX "participant_lookup_idx" ON "MessageParticipant" USING btree ("messageId","contactId");--> statement-breakpoint
CREATE INDEX "Order_customerId_idx" ON "Order" USING btree ("customerId");--> statement-breakpoint
CREATE INDEX "Order_name_idx" ON "Order" USING btree ("name");--> statement-breakpoint
CREATE INDEX "Thread_inboxId_idx" ON "Thread" USING btree ("inboxId");--> statement-breakpoint
CREATE UNIQUE INDEX "Thread_integrationId_externalId_key" ON "Thread" USING btree ("integrationId","externalId");--> statement-breakpoint
CREATE INDEX "Thread_integrationId_idx" ON "Thread" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX "Thread_lastMessageAt_idx" ON "Thread" USING btree ("lastMessageAt");--> statement-breakpoint
CREATE INDEX "Thread_organizationId_assigneeId_status_idx" ON "Thread" USING btree ("organizationId","assigneeId","status");--> statement-breakpoint
CREATE INDEX "Thread_organizationId_createdAt_idx" ON "Thread" USING btree ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "Thread_organizationId_idx" ON "Thread" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Thread_organizationId_messageType_status_idx" ON "Thread" USING btree ("organizationId","messageType","status");--> statement-breakpoint
CREATE INDEX "Thread_organizationId_status_idx" ON "Thread" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "Thread_status_idx" ON "Thread" USING btree ("status");--> statement-breakpoint
CREATE INDEX "thread_pagination_idx" ON "Thread" USING btree ("organizationId","lastMessageAt" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "thread_participants_idx" ON "Thread" USING btree ("organizationId","participantIds");--> statement-breakpoint
CREATE UNIQUE INDEX "Product_handle_key" ON "Product" USING btree ("handle");--> statement-breakpoint
CREATE UNIQUE INDEX "Integration_organizationId_email_key" ON "Integration" USING btree ("organizationId","email");--> statement-breakpoint
CREATE INDEX "Integration_organizationId_idx" ON "Integration" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Integration_provider_organizationId_idx" ON "Integration" USING btree ("provider","organizationId");--> statement-breakpoint
CREATE INDEX "ResponseTemplate_organizationId_isActive_idx" ON "ResponseTemplate" USING btree ("organizationId","isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "ResponseTemplate_organizationId_name_key" ON "ResponseTemplate" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX "ThreadAnalysis_organizationId_priority_idx" ON "ThreadAnalysis" USING btree ("organizationId","priority");--> statement-breakpoint
CREATE INDEX "ThreadAnalysis_organizationId_status_idx" ON "ThreadAnalysis" USING btree ("organizationId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ThreadAnalysis_threadId_key" ON "ThreadAnalysis" USING btree ("threadId");--> statement-breakpoint
CREATE UNIQUE INDEX "ThreadParticipant_threadId_email_key" ON "ThreadParticipant" USING btree ("threadId","email");--> statement-breakpoint
CREATE INDEX "ThreadTracker_organizationId_resolved_idx" ON "ThreadTracker" USING btree ("organizationId","resolved");--> statement-breakpoint
CREATE INDEX "ThreadTracker_organizationId_resolved_sentAt_type_idx" ON "ThreadTracker" USING btree ("organizationId","resolved","sentAt","type");--> statement-breakpoint
CREATE UNIQUE INDEX "ThreadTracker_organizationId_threadId_messageId_key" ON "ThreadTracker" USING btree ("organizationId","threadId","messageId");--> statement-breakpoint
CREATE INDEX "ThreadTracker_organizationId_type_resolved_sentAt_idx" ON "ThreadTracker" USING btree ("organizationId","type","resolved","sentAt");--> statement-breakpoint
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "ProductMedia_productId_idx" ON "ProductMedia" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "ProductOption_productId_idx" ON "ProductOption" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "shopify_customers_contactId_idx" ON "shopify_customers" USING btree ("contactId");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_customers_defaultAddressId_key" ON "shopify_customers" USING btree ("defaultAddressId");--> statement-breakpoint
CREATE INDEX "shopify_customers_email_idx" ON "shopify_customers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_customers_lastOrderId_key" ON "shopify_customers" USING btree ("lastOrderId");--> statement-breakpoint
CREATE INDEX "shopify_customers_phone_idx" ON "shopify_customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "OrderRefund_orderId_idx" ON "OrderRefund" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "OrderReturn_orderId_idx" ON "OrderReturn" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "OrderLineItem_orderId_idx" ON "OrderLineItem" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "OrderFulfillment_orderId_idx" ON "OrderFulfillment" USING btree ("orderId");--> statement-breakpoint
CREATE INDEX "OrderFulfillment_status_idx" ON "OrderFulfillment" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "Subscription_provider_integrationId_topic_key" ON "Subscription" USING btree ("provider","integrationId","topic");--> statement-breakpoint
CREATE INDEX "WebhookEvent_integrationId_idx" ON "WebhookEvent" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX "WebhookEvent_organizationId_idx" ON "WebhookEvent" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Webhook_organizationId_idx" ON "Webhook" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "WebhookDelivery_webhookId_idx" ON "WebhookDelivery" USING btree ("webhookId");--> statement-breakpoint
CREATE UNIQUE INDEX "Part_sku_key" ON "Part" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "Subpart_parentPartId_childPartId_key" ON "Subpart" USING btree ("parentPartId","childPartId");--> statement-breakpoint
CREATE UNIQUE INDEX "VendorPart_partId_vendorId_key" ON "VendorPart" USING btree ("partId","vendorId");--> statement-breakpoint
CREATE UNIQUE INDEX "Inventory_partId_key" ON "Inventory" USING btree ("partId");--> statement-breakpoint
CREATE UNIQUE INDEX "TicketSequence_organizationId_key" ON "TicketSequence" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "TicketReply_mailgunMessageId_key" ON "TicketReply" USING btree ("mailgunMessageId");--> statement-breakpoint
CREATE INDEX "TicketReply_messageId_idx" ON "TicketReply" USING btree ("messageId");--> statement-breakpoint
CREATE UNIQUE INDEX "TicketReply_messageId_key" ON "TicketReply" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "TicketReply_ticketId_idx" ON "TicketReply" USING btree ("ticketId");--> statement-breakpoint
CREATE UNIQUE INDEX "TicketRelation_ticketId_relatedTicketId_key" ON "TicketRelation" USING btree ("ticketId","relatedTicketId");--> statement-breakpoint
CREATE INDEX "Ticket_contactId_idx" ON "Ticket" USING btree ("contactId");--> statement-breakpoint
CREATE INDEX "Ticket_emailThreadId_idx" ON "Ticket" USING btree ("emailThreadId");--> statement-breakpoint
CREATE UNIQUE INDEX "Ticket_mailgunMessageId_key" ON "Ticket" USING btree ("mailgunMessageId");--> statement-breakpoint
CREATE INDEX "Ticket_organizationId_idx" ON "Ticket" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Ticket_status_idx" ON "Ticket" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Ticket_type_idx" ON "Ticket" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "KnowledgeBase_logoDarkId_key" ON "KnowledgeBase" USING btree ("logoDarkId");--> statement-breakpoint
CREATE UNIQUE INDEX "KnowledgeBase_logoLightId_key" ON "KnowledgeBase" USING btree ("logoLightId");--> statement-breakpoint
CREATE INDEX "KnowledgeBase_organizationId_idx" ON "KnowledgeBase" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "KnowledgeBase_organizationId_slug_key" ON "KnowledgeBase" USING btree ("organizationId","slug");--> statement-breakpoint
CREATE INDEX "TicketNote_authorId_idx" ON "TicketNote" USING btree ("authorId");--> statement-breakpoint
CREATE INDEX "TicketNote_ticketId_idx" ON "TicketNote" USING btree ("ticketId");--> statement-breakpoint
CREATE UNIQUE INDEX "TicketAssignment_ticketId_agentId_isActive_key" ON "TicketAssignment" USING btree ("ticketId","agentId","isActive");--> statement-breakpoint
CREATE UNIQUE INDEX "User_avatarAssetId_key" ON "User" USING btree ("avatarAssetId");--> statement-breakpoint
CREATE UNIQUE INDEX "User_email_key" ON "User" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "MailDomain_organizationId_domain_key" ON "MailDomain" USING btree ("organizationId","domain");--> statement-breakpoint
CREATE INDEX "SnippetFolder_createdById_idx" ON "SnippetFolder" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "SnippetFolder_organizationId_idx" ON "SnippetFolder" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "SnippetFolder_organizationId_parentId_name_key" ON "SnippetFolder" USING btree ("organizationId","parentId","name");--> statement-breakpoint
CREATE INDEX "Snippet_createdById_idx" ON "Snippet" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "Snippet_folderId_idx" ON "Snippet" USING btree ("folderId");--> statement-breakpoint
CREATE INDEX "Snippet_organizationId_idx" ON "Snippet" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Snippet_sharingType_idx" ON "Snippet" USING btree ("sharingType");--> statement-breakpoint
CREATE INDEX "SnippetShare_groupId_idx" ON "SnippetShare" USING btree ("groupId");--> statement-breakpoint
CREATE INDEX "SnippetShare_memberId_idx" ON "SnippetShare" USING btree ("memberId");--> statement-breakpoint
CREATE UNIQUE INDEX "SnippetShare_snippetId_groupId_memberId_key" ON "SnippetShare" USING btree ("snippetId","groupId","memberId");--> statement-breakpoint
CREATE INDEX "SnippetShare_snippetId_idx" ON "SnippetShare" USING btree ("snippetId");--> statement-breakpoint
CREATE INDEX "SignatureIntegrationShare_integrationId_idx" ON "SignatureIntegrationShare" USING btree ("integrationId");--> statement-breakpoint
CREATE INDEX "SignatureIntegrationShare_signatureId_idx" ON "SignatureIntegrationShare" USING btree ("signatureId");--> statement-breakpoint
CREATE UNIQUE INDEX "SignatureIntegrationShare_signatureId_integrationId_key" ON "SignatureIntegrationShare" USING btree ("signatureId","integrationId");--> statement-breakpoint
CREATE INDEX "MailView_isDefault_idx" ON "MailView" USING btree ("isDefault");--> statement-breakpoint
CREATE UNIQUE INDEX "MailView_name_userId_organizationId_key" ON "MailView" USING btree ("name","userId","organizationId");--> statement-breakpoint
CREATE INDEX "MailView_organizationId_idx" ON "MailView" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "MailView_userId_idx" ON "MailView" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "OperatingHours_widgetId_dayOfWeek_key" ON "OperatingHours" USING btree ("widgetId","dayOfWeek");--> statement-breakpoint
CREATE INDEX "OperatingHours_widgetId_idx" ON "OperatingHours" USING btree ("widgetId");--> statement-breakpoint
CREATE UNIQUE INDEX "PlanSubscription_organizationId_key" ON "PlanSubscription" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "PlanSubscription_stripeCustomerId_key" ON "PlanSubscription" USING btree ("stripeCustomerId");--> statement-breakpoint
CREATE INDEX "PaymentMethod_organizationId_idx" ON "PaymentMethod" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Invoice_organizationId_idx" ON "Invoice" USING btree ("organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice" USING btree ("stripeInvoiceId");--> statement-breakpoint
CREATE INDEX "Invoice_subscriptionId_idx" ON "Invoice" USING btree ("subscriptionId");--> statement-breakpoint
CREATE INDEX "Tag_organizationId_idx" ON "Tag" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Tag_parentId_idx" ON "Tag" USING btree ("parentId");--> statement-breakpoint
CREATE UNIQUE INDEX "Tag_title_organizationId_parentId_key" ON "Tag" USING btree ("title","organizationId","parentId");--> statement-breakpoint
CREATE INDEX "Notification_entityType_entityId_idx" ON "Notification" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "Notification_organizationId_idx" ON "Notification" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification" USING btree ("userId","isRead");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_key" ON "session" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "TwoFactor_userId_key" ON "TwoFactor" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "SyncJob_organizationId_integrationCategory_integrationId_idx" ON "SyncJob" USING btree ("organizationId","integrationCategory","integrationId");--> statement-breakpoint
CREATE INDEX "SyncJob_organizationId_integrationCategory_status_idx" ON "SyncJob" USING btree ("organizationId","integrationCategory","status");--> statement-breakpoint
CREATE INDEX "SyncJob_organizationId_type_status_idx" ON "SyncJob" USING btree ("organizationId","type","status");--> statement-breakpoint
CREATE INDEX "TableView_tableId_organizationId_idx" ON "TableView" USING btree ("tableId","organizationId");--> statement-breakpoint
CREATE UNIQUE INDEX "TableView_tableId_organizationId_isDefault_key" ON "TableView" USING btree ("tableId","organizationId","isDefault");--> statement-breakpoint
CREATE INDEX "TableView_tableId_userId_idx" ON "TableView" USING btree ("tableId","userId");--> statement-breakpoint
CREATE UNIQUE INDEX "TableView_tableId_userId_name_key" ON "TableView" USING btree ("tableId","userId","name");--> statement-breakpoint
CREATE INDEX "RuleGroup_enabled_idx" ON "RuleGroup" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "RuleGroup_organizationId_enabled_idx" ON "RuleGroup" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE INDEX "RuleGroup_organizationId_idx" ON "RuleGroup" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "RuleGroupRule_groupId_idx" ON "RuleGroupRule" USING btree ("groupId");--> statement-breakpoint
CREATE UNIQUE INDEX "RuleGroupRule_groupId_ruleId_key" ON "RuleGroupRule" USING btree ("groupId","ruleId");--> statement-breakpoint
CREATE INDEX "RuleGroupRule_ruleId_idx" ON "RuleGroupRule" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX "RuleGroupRelation_childId_idx" ON "RuleGroupRelation" USING btree ("childId");--> statement-breakpoint
CREATE UNIQUE INDEX "RuleGroupRelation_parentId_childId_key" ON "RuleGroupRelation" USING btree ("parentId","childId");--> statement-breakpoint
CREATE INDEX "RuleGroupRelation_parentId_idx" ON "RuleGroupRelation" USING btree ("parentId");--> statement-breakpoint
CREATE INDEX "TestCase_createdById_idx" ON "TestCase" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "TestCase_organizationId_idx" ON "TestCase" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "TestCase_status_idx" ON "TestCase" USING btree ("status");--> statement-breakpoint
CREATE INDEX "TestSuite_organizationId_idx" ON "TestSuite" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "TestCaseInSuite_suiteId_idx" ON "TestCaseInSuite" USING btree ("suiteId");--> statement-breakpoint
CREATE UNIQUE INDEX "TestCaseInSuite_suiteId_testCaseId_key" ON "TestCaseInSuite" USING btree ("suiteId","testCaseId");--> statement-breakpoint
CREATE INDEX "TestCaseInSuite_testCaseId_idx" ON "TestCaseInSuite" USING btree ("testCaseId");--> statement-breakpoint
CREATE INDEX "RuleInSuite_ruleId_idx" ON "RuleInSuite" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX "RuleInSuite_suiteId_idx" ON "RuleInSuite" USING btree ("suiteId");--> statement-breakpoint
CREATE UNIQUE INDEX "RuleInSuite_suiteId_ruleId_key" ON "RuleInSuite" USING btree ("suiteId","ruleId");--> statement-breakpoint
CREATE INDEX "TestRun_organizationId_idx" ON "TestRun" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "TestRun_startedAt_idx" ON "TestRun" USING btree ("startedAt");--> statement-breakpoint
CREATE INDEX "TestRun_status_idx" ON "TestRun" USING btree ("status");--> statement-breakpoint
CREATE INDEX "TestRun_suiteId_idx" ON "TestRun" USING btree ("suiteId");--> statement-breakpoint
CREATE INDEX "TestResult_passed_idx" ON "TestResult" USING btree ("passed");--> statement-breakpoint
CREATE INDEX "TestResult_runId_idx" ON "TestResult" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "TestResult_testCaseId_idx" ON "TestResult" USING btree ("testCaseId");--> statement-breakpoint
CREATE INDEX "RuleAction_ruleId_idx" ON "RuleAction" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX "RuleAction_ruleId_order_idx" ON "RuleAction" USING btree ("ruleId","order");--> statement-breakpoint
CREATE INDEX "Rule_organizationId_enabled_idx" ON "Rule" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "Rule_organizationId_name_key" ON "Rule" USING btree ("organizationId","name");--> statement-breakpoint
CREATE INDEX "Rule_organizationId_staticRuleType_idx" ON "Rule" USING btree ("organizationId","staticRuleType");--> statement-breakpoint
CREATE INDEX "Rule_organizationId_type_enabled_idx" ON "Rule" USING btree ("organizationId","type","enabled");--> statement-breakpoint
CREATE INDEX "Rule_organizationId_type_idx" ON "Rule" USING btree ("organizationId","type");--> statement-breakpoint
CREATE INDEX "ProposedAction_messageId_idx" ON "ProposedAction" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "ProposedAction_organizationId_status_idx" ON "ProposedAction" USING btree ("organizationId","status");--> statement-breakpoint
CREATE INDEX "ProposedAction_ruleId_idx" ON "ProposedAction" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX "ProposedAction_status_createdAt_idx" ON "ProposedAction" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "ShopifyAutomationMetrics_date_idx" ON "ShopifyAutomationMetrics" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "ShopifyAutomationMetrics_organizationId_date_key" ON "ShopifyAutomationMetrics" USING btree ("organizationId","date");--> statement-breakpoint
CREATE INDEX "ShopifyAutomationRule_ruleId_idx" ON "ShopifyAutomationRule" USING btree ("ruleId");--> statement-breakpoint
CREATE UNIQUE INDEX "ShopifyAutomationRule_ruleId_key" ON "ShopifyAutomationRule" USING btree ("ruleId");--> statement-breakpoint
CREATE INDEX "IntegrationTagLabel_integrationId_idx" ON "IntegrationTagLabel" USING btree ("integrationId");--> statement-breakpoint
CREATE UNIQUE INDEX "IntegrationTagLabel_integrationId_labelId_key" ON "IntegrationTagLabel" USING btree ("integrationId","labelId");--> statement-breakpoint
CREATE UNIQUE INDEX "IntegrationTagLabel_integrationId_tagId_key" ON "IntegrationTagLabel" USING btree ("integrationId","tagId");--> statement-breakpoint
CREATE INDEX "IntegrationTagLabel_organizationId_idx" ON "IntegrationTagLabel" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "SearchHistory_userId_organizationId_searchedAt_idx" ON "SearchHistory" USING btree ("userId","organizationId","searchedAt");--> statement-breakpoint
CREATE INDEX "LoadBalancingConfig_organizationId_provider_model_idx" ON "LoadBalancingConfig" USING btree ("organizationId","provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX "LoadBalancingConfig_organizationId_provider_model_modelType_key" ON "LoadBalancingConfig" USING btree ("organizationId","provider","model","modelType","name");--> statement-breakpoint
CREATE INDEX "ProviderPreference_organizationId_provider_idx" ON "ProviderPreference" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "ProviderPreference_organizationId_provider_key" ON "ProviderPreference" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE INDEX "ModelConfiguration_organizationId_enabled_idx" ON "ModelConfiguration" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE INDEX "ModelConfiguration_organizationId_provider_idx" ON "ModelConfiguration" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "ModelConfiguration_organizationId_provider_model_modelType_key" ON "ModelConfiguration" USING btree ("organizationId","provider","model","modelType");--> statement-breakpoint
CREATE INDEX "Workflow_organizationId_enabled_idx" ON "Workflow" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE INDEX "Workflow_organizationId_triggerType_idx" ON "Workflow" USING btree ("organizationId","triggerType");--> statement-breakpoint
CREATE UNIQUE INDEX "WorkflowApp_draftWorkflowId_key" ON "WorkflowApp" USING btree ("draftWorkflowId");--> statement-breakpoint
CREATE INDEX "WorkflowApp_organizationId_enabled_idx" ON "WorkflowApp" USING btree ("organizationId","enabled");--> statement-breakpoint
CREATE INDEX "WorkflowApp_organizationId_isPublic_idx" ON "WorkflowApp" USING btree ("organizationId","isPublic");--> statement-breakpoint
CREATE UNIQUE INDEX "WorkflowApp_workflowId_key" ON "WorkflowApp" USING btree ("workflowId");--> statement-breakpoint
CREATE INDEX "ProviderConfiguration_organizationId_provider_idx" ON "ProviderConfiguration" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "ProviderConfiguration_organizationId_provider_key" ON "ProviderConfiguration" USING btree ("organizationId","provider");--> statement-breakpoint
CREATE INDEX "WorkflowRun_createdAt_idx" ON "WorkflowRun" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "WorkflowRun_organizationId_workflowAppId_idx" ON "WorkflowRun" USING btree ("organizationId","workflowAppId");--> statement-breakpoint
CREATE INDEX "WorkflowRun_resumeAt_idx" ON "WorkflowRun" USING btree ("resumeAt");--> statement-breakpoint
CREATE INDEX "WorkflowRun_status_idx" ON "WorkflowRun" USING btree ("status");--> statement-breakpoint
CREATE INDEX "WorkflowRun_workflowId_idx" ON "WorkflowRun" USING btree ("workflowId");--> statement-breakpoint
CREATE INDEX "WorkflowNodeExecution_nodeId_idx" ON "WorkflowNodeExecution" USING btree ("nodeId");--> statement-breakpoint
CREATE INDEX "WorkflowNodeExecution_status_idx" ON "WorkflowNodeExecution" USING btree ("status");--> statement-breakpoint
CREATE INDEX "WorkflowNodeExecution_workflowRunId_idx" ON "WorkflowNodeExecution" USING btree ("workflowRunId");--> statement-breakpoint
CREATE INDEX "WorkflowJoinState_executionId_idx" ON "WorkflowJoinState" USING btree ("executionId");--> statement-breakpoint
CREATE UNIQUE INDEX "WorkflowJoinState_executionId_joinNodeId_key" ON "WorkflowJoinState" USING btree ("executionId","joinNodeId");--> statement-breakpoint
CREATE INDEX "WorkflowJoinState_workflowId_idx" ON "WorkflowJoinState" USING btree ("workflowId");--> statement-breakpoint
CREATE INDEX "WorkflowFile_expiresAt_idx" ON "WorkflowFile" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "WorkflowFile_nodeId_idx" ON "WorkflowFile" USING btree ("nodeId");--> statement-breakpoint
CREATE UNIQUE INDEX "WorkflowFile_workflowId_fileId_key" ON "WorkflowFile" USING btree ("workflowId","fileId");--> statement-breakpoint
CREATE INDEX "WorkflowFile_workflowId_idx" ON "WorkflowFile" USING btree ("workflowId");--> statement-breakpoint
CREATE INDEX "WorkflowCredentials_createdById_idx" ON "WorkflowCredentials" USING btree ("createdById");--> statement-breakpoint
CREATE INDEX "WorkflowCredentials_organizationId_idx" ON "WorkflowCredentials" USING btree ("organizationId");--> statement-breakpoint
CREATE INDEX "WorkflowCredentials_organizationId_type_idx" ON "WorkflowCredentials" USING btree ("organizationId","type");--> statement-breakpoint
CREATE INDEX "StorageLocation_credentialId_idx" ON "StorageLocation" USING btree ("credentialId");--> statement-breakpoint
CREATE INDEX "StorageLocation_provider_externalId_idx" ON "StorageLocation" USING btree ("provider","externalId");--> statement-breakpoint
CREATE INDEX "UploadSession_organizationId_createdById_idx" ON "UploadSession" USING btree ("organizationId","createdById");--> statement-breakpoint
CREATE INDEX "UploadSession_provider_externalId_idx" ON "UploadSession" USING btree ("provider","externalId");