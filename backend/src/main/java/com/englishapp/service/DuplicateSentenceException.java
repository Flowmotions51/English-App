package com.englishapp.service;

import java.util.List;

public class DuplicateSentenceException extends RuntimeException {
    private final List<String> existingListNames;

    public DuplicateSentenceException(String message, List<String> existingListNames) {
        super(message);
        this.existingListNames = existingListNames;
    }

    public List<String> getExistingListNames() {
        return existingListNames;
    }
}
