package com.isp.common.exception;

import com.isp.common.dto.ErrorDetail;

import java.util.List;

public class ResourceNotFoundException extends ServiceException {
    public ResourceNotFoundException(String resourceName, String resourceId) {
        super("RESOURCE_NOT_FOUND",
                resourceName + " not found: " + resourceId,
                List.of(new ErrorDetail(resourceName, "RESOURCE_NOT_FOUND", resourceId)));
    }
}
